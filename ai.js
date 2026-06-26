import {
  compareHands,
  createDeck,
  evaluateBestHand,
  getCardValue,
} from "./poker.js";

const MONTE_CARLO_SAMPLES = {
  preflop: 350,
  flop: 600,
  turn: 800,
  river: 1200,
};

const STAGE_THRESHOLDS = {
  preflop: {
    valueBet: 0.58,
    valueRaise: 0.68,
    thinValue: 0.52,
  },
  flop: {
    valueBet: 0.62,
    valueRaise: 0.72,
    thinValue: 0.55,
  },
  turn: {
    valueBet: 0.65,
    valueRaise: 0.75,
    thinValue: 0.58,
  },
  river: {
    valueBet: 0.67,
    valueRaise: 0.78,
    thinValue: 0.6,
  },
};

export function decideAIAction(gameState) {
  const stage = normalizeStage(gameState.stage);
  const aiCards = gameState.aiCards ?? [];
  const communityCards = gameState.communityCards ?? [];
  const toCall = Math.max(0, gameState.currentBet - gameState.aiCurrentBet);
  const chips = gameState.aiChips ?? 0;
  const pot = Math.max(gameState.pot ?? 0, 1);
  const raiseCount = gameState.raiseCount ?? 0;
  const maxRaises = gameState.maxRaises ?? 2;
  const opponentCanRespond = (gameState.playerChips ?? 0) > 0;
  const canRaise = opponentCanRespond && chips > toCall && raiseCount < maxRaises;

  if (chips <= 0) {
    return {
      action: "check",
      amount: 0,
      strength: 0,
      equity: 0,
      reason: "no-chips",
    };
  }

  const equity = estimateEquity(aiCards, communityCards, stage);
  const drawScore = estimateDrawPotential(aiCards, communityCards);
  const blockerScore = estimateBlockerScore(aiCards, communityCards);
  const boardTexture = analyzeBoardTexture(communityCards);
  const mixedEquity = clamp(
    equity + drawScore * 0.06 + blockerScore * 0.03 + randomBetween(-0.015, 0.015),
    0,
    1
  );

  const info = {
    gameState,
    stage,
    aiCards,
    communityCards,
    toCall,
    chips,
    pot,
    canRaise,
    equity,
    mixedEquity,
    drawScore,
    blockerScore,
    boardTexture,
  };

  if (toCall > 0) {
    return decideFacingBet(info);
  }

  return decideWhenCheckedTo(info);
}

export function estimateHandStrength(aiCards, communityCards, stage = "preflop") {
  if (!Array.isArray(aiCards) || aiCards.length !== 2) {
    return 0;
  }

  if (!Array.isArray(communityCards)) {
    return 0;
  }

  if (communityCards.length < 3) {
    return estimatePreflopStrength(aiCards);
  }

  return estimateEquity(aiCards, communityCards, normalizeStage(stage));
}

function decideFacingBet(info) {
  const {
    gameState,
    stage,
    toCall,
    chips,
    pot,
    canRaise,
    equity,
    mixedEquity,
    drawScore,
    blockerScore,
    boardTexture,
  } = info;

  const thresholds = STAGE_THRESHOLDS[stage];
  const potOdds = toCall / (pot + toCall);
  const mdf = pot / (pot + toCall);
  const isValueRaise = mixedEquity >= thresholds.valueRaise;
  const hasGoodSemiBluff =
    stage !== "river" &&
    drawScore >= 0.28 &&
    blockerScore >= 0.08 &&
    mixedEquity < thresholds.valueRaise;
  const hasRiverBluffCandidate =
    stage === "river" &&
    blockerScore >= 0.22 &&
    mixedEquity < 0.5;

  if (canRaise) {
    const valueRaiseProbability = clamp(
      sigmoid((mixedEquity - thresholds.valueRaise) * 14) * 0.75,
      0,
      0.9
    );
    const bluffRaiseProbability = clamp(
      drawScore * 0.28 + blockerScore * 0.18 - Math.max(0, mixedEquity - 0.65) * 0.25,
      0,
      stage === "river" ? 0.22 : 0.35
    );

    if (isValueRaise && Math.random() < valueRaiseProbability) {
      return {
        action: "raise",
        amount: Math.min(chips, toCall + chooseRaiseExtra(gameState, boardTexture, "value")),
        strength: equity,
        equity,
        reason: "value-raise",
      };
    }

    if ((hasGoodSemiBluff || hasRiverBluffCandidate) && Math.random() < bluffRaiseProbability) {
      return {
        action: "raise",
        amount: Math.min(chips, toCall + chooseRaiseExtra(gameState, boardTexture, "bluff")),
        strength: equity,
        equity,
        reason: "bluff-raise",
      };
    }
  }

  const callProbability = calculateCallProbability({
    equity: mixedEquity,
    potOdds,
    mdf,
    drawScore,
    blockerScore,
    stage,
  });

  if (Math.random() < callProbability) {
    return {
      action: "call",
      amount: Math.min(chips, toCall),
      strength: equity,
      equity,
      reason: "pot-odds-call",
    };
  }

  return {
    action: "fold",
    amount: 0,
    strength: equity,
    equity,
    reason: "fold-below-threshold",
  };
}

function decideWhenCheckedTo(info) {
  const {
    gameState,
    stage,
    equity,
    mixedEquity,
    drawScore,
    blockerScore,
    boardTexture,
  } = info;

  const thresholds = STAGE_THRESHOLDS[stage];
  const isStrongValue = mixedEquity >= thresholds.valueBet;
  const isThinValue = mixedEquity >= thresholds.thinValue && mixedEquity < thresholds.valueBet;
  const isSemiBluff =
    stage !== "river" &&
    mixedEquity < thresholds.valueBet &&
    drawScore >= 0.25;
  const isRiverBluff =
    stage === "river" &&
    mixedEquity < 0.48 &&
    blockerScore >= 0.2;

  if (isStrongValue) {
    const betProbability = clamp(
      sigmoid((mixedEquity - thresholds.valueBet) * 12) * 0.85,
      0.35,
      0.95
    );

    if (Math.random() < betProbability) {
      return {
        action: "bet",
        amount: chooseBetSize(gameState, boardTexture, "value"),
        strength: equity,
        equity,
        reason: "value-bet",
      };
    }
  }

  if (isSemiBluff) {
    const semiBluffProbability = clamp(drawScore * 0.45 + blockerScore * 0.12, 0.08, 0.42);

    if (Math.random() < semiBluffProbability) {
      return {
        action: "bet",
        amount: chooseBetSize(gameState, boardTexture, "semi-bluff"),
        strength: equity,
        equity,
        reason: "semi-bluff",
      };
    }
  }

  if (isRiverBluff) {
    const riverBluffProbability = clamp(blockerScore * 0.35, 0.04, 0.22);

    if (Math.random() < riverBluffProbability) {
      return {
        action: "bet",
        amount: chooseBetSize(gameState, boardTexture, "bluff"),
        strength: equity,
        equity,
        reason: "river-blocker-bluff",
      };
    }
  }

  if (isThinValue && Math.random() < 0.18) {
    return {
      action: "bet",
      amount: chooseBetSize(gameState, boardTexture, "thin-value"),
      strength: equity,
      equity,
      reason: "thin-value-bet",
    };
  }

  return {
    action: "check",
    amount: 0,
    strength: equity,
    equity,
    reason: "range-check",
  };
}

function estimateEquity(aiCards, communityCards, stage) {
  if (!Array.isArray(aiCards) || aiCards.length !== 2) {
    return 0;
  }

  const knownCards = [...aiCards, ...communityCards];
  const deck = createRemainingDeck(knownCards);
  const boardCardsNeeded = Math.max(0, 5 - communityCards.length);
  const samples = MONTE_CARLO_SAMPLES[stage] ?? 500;
  let wins = 0;
  let ties = 0;
  let total = 0;

  for (let index = 0; index < samples; index += 1) {
    const shuffled = shuffleCopy(deck);
    const opponentCards = shuffled.slice(0, 2);
    const runout = shuffled.slice(2, 2 + boardCardsNeeded);
    const finalBoard = [...communityCards, ...runout];

    if (finalBoard.length !== 5) {
      continue;
    }

    const aiHand = evaluateBestHand([...aiCards, ...finalBoard]);
    const opponentHand = evaluateBestHand([...opponentCards, ...finalBoard]);
    const result = compareHands(aiHand, opponentHand);

    if (result > 0) {
      wins += 1;
    } else if (result === 0) {
      ties += 1;
    }

    total += 1;
  }

  if (total === 0) {
    return estimatePreflopStrength(aiCards);
  }

  return clamp((wins + ties * 0.5) / total, 0, 1);
}

function estimatePreflopStrength(cards) {
  const [first, second] = cards;
  const values = cards.map(getCardValue).sort((a, b) => b - a);
  const high = values[0];
  const low = values[1];
  const isPair = high === low;
  const isSuited = first.suit === second.suit;
  const gap = high - low;
  let strength = (high + low) / 28;

  if (isPair) {
    strength += high >= 10 ? 0.38 : 0.25;
  }

  if (isSuited) {
    strength += 0.08;
  }

  if (gap === 1) {
    strength += 0.08;
  } else if (gap === 2) {
    strength += 0.04;
  } else if (gap >= 5) {
    strength -= 0.08;
  }

  if (high >= 13 && low >= 10) {
    strength += 0.12;
  }

  if (high <= 8 && gap > 4) {
    strength -= 0.12;
  }

  return clamp(strength, 0.05, 0.95);
}

function calculateCallProbability({
  equity,
  potOdds,
  mdf,
  drawScore,
  blockerScore,
  stage,
}) {
  const surplus = equity - potOdds;
  let probability = sigmoid(surplus * 13);

  if (stage !== "river") {
    probability += drawScore * 0.12;
  }

  if (stage === "river") {
    probability += blockerScore * 0.05;
  }

  probability += clamp(mdf - 0.5, 0, 0.18);

  if (equity >= 0.82) {
    probability = Math.max(probability, 0.92);
  }

  if (equity < potOdds - 0.18) {
    probability = Math.min(probability, 0.12);
  }

  return clamp(probability, 0.02, 0.98);
}

function chooseBetSize(gameState, boardTexture, purpose) {
  const chips = gameState.aiChips ?? 0;
  const pot = Math.max(gameState.pot ?? 0, 1);
  const defaultBet = gameState.defaultBet ?? 50;
  const stage = normalizeStage(gameState.stage);
  let fraction;

  if (stage === "preflop") {
    fraction = 0.5;
  } else if (purpose === "thin-value") {
    fraction = 0.33;
  } else if (purpose === "bluff") {
    fraction = stage === "river" ? 0.75 : 0.55;
  } else if (purpose === "semi-bluff") {
    fraction = boardTexture.wetness >= 0.55 ? 0.66 : 0.5;
  } else {
    fraction = boardTexture.wetness >= 0.55 ? 0.66 : 0.4;
  }

  return clampAmount(roundTo10(Math.max(defaultBet, pot * fraction)), chips);
}

function chooseRaiseExtra(gameState, boardTexture, purpose) {
  const chips = gameState.aiChips ?? 0;
  const pot = Math.max(gameState.pot ?? 0, 1);
  const defaultRaise = gameState.raiseAmount ?? 100;
  const stage = normalizeStage(gameState.stage);
  let fraction;

  if (stage === "preflop") {
    fraction = purpose === "bluff" ? 0.55 : 0.75;
  } else if (purpose === "bluff") {
    fraction = boardTexture.wetness >= 0.55 ? 0.55 : 0.45;
  } else {
    fraction = boardTexture.wetness >= 0.55 ? 0.85 : 0.65;
  }

  return clampAmount(roundTo10(Math.max(defaultRaise, pot * fraction)), chips);
}

function estimateDrawPotential(aiCards, communityCards) {
  if (!Array.isArray(communityCards) || communityCards.length < 3 || communityCards.length >= 5) {
    return 0;
  }

  const allCards = [...aiCards, ...communityCards];
  let score = 0;

  if (hasFlushDraw(aiCards, allCards)) {
    score += 0.36;
  }

  score += getStraightDrawScore(aiCards, allCards);

  if (hasTwoOvercards(aiCards, communityCards)) {
    score += 0.08;
  }

  return clamp(score, 0, 1);
}

function estimateBlockerScore(aiCards, communityCards) {
  if (!Array.isArray(aiCards) || aiCards.length !== 2) {
    return 0;
  }

  const values = aiCards.map(getCardValue);
  const boardSuitCounts = countBy(communityCards ?? [], (card) => card.suit);
  let score = 0;

  for (const value of values) {
    if (value === 14) {
      score += 0.12;
    } else if (value === 13) {
      score += 0.08;
    } else if (value === 12) {
      score += 0.04;
    }
  }

  for (const card of aiCards) {
    const boardSameSuitCount = boardSuitCounts.get(card.suit) ?? 0;
    const cardValue = getCardValue(card);

    if (boardSameSuitCount >= 3 && cardValue === 14) {
      score += 0.18;
    } else if (boardSameSuitCount >= 3 && cardValue === 13) {
      score += 0.1;
    }
  }

  return clamp(score, 0, 1);
}

function analyzeBoardTexture(communityCards) {
  if (!Array.isArray(communityCards) || communityCards.length < 3) {
    return {
      wetness: 0.35,
      paired: false,
      monotone: false,
      twoTone: false,
      straightConnected: false,
    };
  }

  const rankCounts = countBy(communityCards, getCardValue);
  const suitCounts = countBy(communityCards, (card) => card.suit);
  const maxSuitCount = Math.max(...suitCounts.values());
  const paired = [...rankCounts.values()].some((count) => count >= 2);
  const monotone = maxSuitCount >= 3;
  const twoTone = maxSuitCount === 2;
  const values = normalizeStraightValues(communityCards.map(getCardValue));
  const straightConnected = hasStraightConnectivity(values);
  let wetness = 0.2;

  if (monotone) {
    wetness += 0.35;
  } else if (twoTone) {
    wetness += 0.18;
  }

  if (straightConnected) {
    wetness += 0.28;
  }

  if (paired) {
    wetness += 0.08;
  }

  return {
    wetness: clamp(wetness, 0, 1),
    paired,
    monotone,
    twoTone,
    straightConnected,
  };
}

function hasFlushDraw(aiCards, allCards) {
  const suitCounts = countBy(allCards, (card) => card.suit);

  for (const [suit, count] of suitCounts.entries()) {
    if (count === 4 && aiCards.some((card) => card.suit === suit)) {
      return true;
    }
  }

  return false;
}

function getStraightDrawScore(aiCards, allCards) {
  const allValues = normalizeStraightValues(allCards.map(getCardValue));
  const aiValues = new Set(normalizeStraightValues(aiCards.map(getCardValue)));
  let bestScore = 0;

  for (let start = 1; start <= 10; start += 1) {
    const window = [start, start + 1, start + 2, start + 3, start + 4];
    const present = window.filter((value) => allValues.has(value));
    const aiContributes = window.some((value) => aiValues.has(value));

    if (!aiContributes) {
      continue;
    }

    if (present.length === 4) {
      bestScore = Math.max(bestScore, 0.28);
    } else if (present.length === 3) {
      bestScore = Math.max(bestScore, 0.12);
    }
  }

  return bestScore;
}

function hasTwoOvercards(aiCards, communityCards) {
  if (!communityCards.length) {
    return false;
  }

  const highestBoardCard = Math.max(...communityCards.map(getCardValue));
  const overcards = aiCards.filter((card) => getCardValue(card) > highestBoardCard);

  return overcards.length === 2;
}

function createRemainingDeck(knownCards) {
  const knownKeys = new Set(knownCards.map(cardKey));
  return createDeck().filter((card) => !knownKeys.has(cardKey(card)));
}

function cardKey(card) {
  return `${getCardValue(card)}-${card.suit}`;
}

function shuffleCopy(deck) {
  const copy = [...deck];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}

function normalizeStraightValues(values) {
  const result = new Set(values);

  if (result.has(14)) {
    result.add(1);
  }

  return result;
}

function hasStraightConnectivity(values) {
  for (let start = 1; start <= 10; start += 1) {
    const window = [start, start + 1, start + 2, start + 3, start + 4];
    const presentCount = window.filter((value) => values.has(value)).length;

    if (presentCount >= 3) {
      return true;
    }
  }

  return false;
}

function countBy(items, getKey) {
  const map = new Map();

  for (const item of items) {
    const key = getKey(item);
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  return map;
}

function normalizeStage(stage) {
  const normalized = String(stage ?? "preflop").toLowerCase();

  if (["preflop", "flop", "turn", "river"].includes(normalized)) {
    return normalized;
  }

  return "preflop";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampAmount(amount, availableChips) {
  return Math.max(0, Math.min(availableChips, Math.round(amount)));
}

function roundTo10(value) {
  return Math.round(value / 10) * 10;
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}
