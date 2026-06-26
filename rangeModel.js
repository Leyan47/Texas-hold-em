import { getCardValue } from "./poker.js";
import { getPreflopRangeWeight } from "./preflopCharts.js";

export function buildPlayerRangeModel(gameState = {}) {
  const pot = Math.max(gameState.pot ?? 0, 1);
  const toCall = Math.max(0, (gameState.currentBet ?? 0) - (gameState.aiCurrentBet ?? 0));
  const playerContribution = gameState.playerCurrentBet ?? 0;
  const pressure = toCall / (pot + toCall);
  const aggression = playerContribution > 0 || toCall > 0 ? "aggressive" : "passive";
  const rangeBucket = pressure >= 0.32 || playerContribution >= pot * 0.45
    ? "tight"
    : pressure >= 0.12
      ? "neutral"
      : "wide";
  const minimumWeight = rangeBucket === "tight" ? 0.52 : rangeBucket === "neutral" ? 0.28 : 0.08;

  return {
    aggression,
    pressure,
    rangeBucket,
    minimumWeight,
    acceptsCards(cards) {
      return getPreflopRangeWeight(cards) >= minimumWeight;
    },
  };
}

export function getInformationSetKey({
  gameState,
  equity,
  drawScore,
  blockerScore,
  rangeModel,
} = {}) {
  const stage = normalizeStage(gameState?.stage);
  const toCall = Math.max(0, (gameState?.currentBet ?? 0) - (gameState?.aiCurrentBet ?? 0));
  const node = toCall > 0 ? "facing-bet" : "root";
  const pressureBucket = bucketToCall(toCall, gameState?.pot ?? 0);
  const potBucket = bucketPot(gameState?.pot ?? 0);
  const rangeBucket = rangeModel?.rangeBucket ?? "neutral";
  const equityBucket = bucketEquity(equity ?? 0);
  const boardTexture = analyzeBoardTexture(gameState?.communityCards ?? []);
  const drawBucket = drawScore >= 0.25 ? "draw" : blockerScore >= 0.2 ? "blocker" : boardTexture.bucket;

  return `${stage}|${node}|${pressureBucket}|${potBucket}|range-${rangeBucket}|${equityBucket}|${drawBucket}`;
}

export function estimateDrawPotential(aiCards, communityCards) {
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

export function estimateBlockerScore(aiCards, communityCards) {
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
    const value = getCardValue(card);

    if (boardSameSuitCount >= 3 && value === 14) {
      score += 0.18;
    } else if (boardSameSuitCount >= 3 && value === 13) {
      score += 0.1;
    }
  }

  return clamp(score, 0, 1);
}

export function analyzeBoardTexture(communityCards) {
  if (!Array.isArray(communityCards) || communityCards.length < 3) {
    return {
      bucket: "dry",
      wetness: 0.2,
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

  if (monotone) wetness += 0.35;
  else if (twoTone) wetness += 0.18;
  if (straightConnected) wetness += 0.28;
  if (paired) wetness += 0.08;

  return {
    bucket: wetness >= 0.6 ? "wet" : wetness >= 0.38 ? "dynamic" : "dry",
    wetness: clamp(wetness, 0, 1),
    paired,
    monotone,
    twoTone,
    straightConnected,
  };
}

export function bucketEquity(equity) {
  if (equity >= 0.86) return "equity-nut";
  if (equity >= 0.68) return "equity-high";
  if (equity >= 0.45) return "equity-medium";
  if (equity >= 0.25) return "equity-low";
  return "equity-air";
}

export function bucketPot(pot) {
  if (pot >= 500) return "large";
  if (pot >= 120) return "medium";
  return "small";
}

export function bucketToCall(toCall, pot) {
  if (toCall <= 0) return "none";
  const pressure = toCall / Math.max(pot + toCall, 1);
  if (pressure >= 0.33) return "high-pressure";
  if (pressure >= 0.15) return "pressure";
  return "low-pressure";
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

    if (!aiContributes) continue;
    if (present.length === 4) bestScore = Math.max(bestScore, 0.28);
    else if (present.length === 3) bestScore = Math.max(bestScore, 0.12);
  }

  return bestScore;
}

function hasTwoOvercards(aiCards, communityCards) {
  if (!communityCards.length) return false;

  const highestBoardCard = Math.max(...communityCards.map(getCardValue));
  const overcards = aiCards.filter((card) => getCardValue(card) > highestBoardCard);
  return overcards.length === 2;
}

function normalizeStraightValues(values) {
  const result = new Set(values);
  if (result.has(14)) result.add(1);
  return result;
}

function hasStraightConnectivity(values) {
  for (let start = 1; start <= 10; start += 1) {
    const window = [start, start + 1, start + 2, start + 3, start + 4];
    const presentCount = window.filter((value) => values.has(value)).length;
    if (presentCount >= 3) return true;
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
  return ["preflop", "flop", "turn", "river"].includes(normalized) ? normalized : "preflop";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
