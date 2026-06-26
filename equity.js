import {
  compareHands,
  createDeck,
  evaluateBestHand,
  getCardValue,
} from "./poker.js";
import { getPreflopRangeWeight } from "./preflopCharts.js";

export const MONTE_CARLO_SAMPLES = {
  preflop: 350,
  flop: 600,
  turn: 800,
  river: 1200,
};

export function estimateEquity({
  aiCards,
  communityCards = [],
  stage = "preflop",
  samples,
  opponentRangeModel,
} = {}) {
  if (!Array.isArray(aiCards) || aiCards.length !== 2) {
    return 0;
  }

  if (!Array.isArray(communityCards)) {
    return 0;
  }

  if (communityCards.length < 3) {
    return estimatePreflopStrength(aiCards);
  }

  const knownCards = [...aiCards, ...communityCards];
  const deck = createRemainingDeck(knownCards);
  const boardCardsNeeded = Math.max(0, 5 - communityCards.length);
  const sampleCount = samples ?? MONTE_CARLO_SAMPLES[normalizeStage(stage)] ?? 500;
  let wins = 0;
  let ties = 0;
  let total = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const shuffled = shuffleCopy(deck);
    const opponentCards = pickOpponentCards(shuffled, opponentRangeModel);
    const opponentKeys = new Set(opponentCards.map(cardKey));
    const remaining = shuffled.filter((card) => !opponentKeys.has(cardKey(card)));
    const runout = remaining.slice(0, boardCardsNeeded);
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

export function estimatePreflopStrength(cards) {
  return getPreflopRangeWeight(cards);
}

export function createRemainingDeck(knownCards) {
  const knownKeys = new Set(knownCards.map(cardKey));
  return createDeck().filter((card) => !knownKeys.has(cardKey(card)));
}

export function shuffleCopy(deck) {
  const copy = [...deck];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}

function pickOpponentCards(shuffled, opponentRangeModel) {
  if (!opponentRangeModel?.acceptsCards) {
    return shuffled.slice(0, 2);
  }

  for (let index = 0; index < shuffled.length - 1; index += 1) {
    const candidate = [shuffled[index], shuffled[index + 1]];
    if (opponentRangeModel.acceptsCards(candidate)) {
      return candidate;
    }
  }

  return shuffled.slice(0, 2);
}

function cardKey(card) {
  return `${getCardValue(card)}-${card.suit}`;
}

function normalizeStage(stage) {
  const normalized = String(stage ?? "preflop").toLowerCase();
  return ["preflop", "flop", "turn", "river"].includes(normalized) ? normalized : "preflop";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
