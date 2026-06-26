import { getCardValue } from "./poker.js";

const RANK_LABELS = new Map([
  [14, "A"],
  [13, "K"],
  [12, "Q"],
  [11, "J"],
  [10, "T"],
  [9, "9"],
  [8, "8"],
  [7, "7"],
  [6, "6"],
  [5, "5"],
  [4, "4"],
  [3, "3"],
  [2, "2"],
]);

const RANK_VALUES = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];

export const PREFLOP_CHART = buildPreflopChart();

export function getPreflopHandKey(cards) {
  if (!Array.isArray(cards) || cards.length !== 2) {
    return "unknown";
  }

  const [first, second] = cards;
  const firstValue = getCardValue(first);
  const secondValue = getCardValue(second);
  const high = Math.max(firstValue, secondValue);
  const low = Math.min(firstValue, secondValue);
  const highLabel = RANK_LABELS.get(high);
  const lowLabel = RANK_LABELS.get(low);

  if (high === low) {
    return `${highLabel}${lowLabel}`;
  }

  return `${highLabel}${lowLabel}${first.suit === second.suit ? "s" : "o"}`;
}

export function getPreflopRangeWeight(cardsOrKey) {
  const key = typeof cardsOrKey === "string" ? cardsOrKey : getPreflopHandKey(cardsOrKey);
  return PREFLOP_CHART.get(key) ?? 0.05;
}

export function classifyPreflopHand(cardsOrKey) {
  const weight = getPreflopRangeWeight(cardsOrKey);

  if (weight >= 0.86) return "premium";
  if (weight >= 0.68) return "strong";
  if (weight >= 0.46) return "playable";
  if (weight >= 0.28) return "speculative";
  return "trash";
}

function buildPreflopChart() {
  const chart = new Map();

  for (const high of RANK_VALUES) {
    for (const low of RANK_VALUES) {
      if (high < low) continue;

      const highLabel = RANK_LABELS.get(high);
      const lowLabel = RANK_LABELS.get(low);

      if (high === low) {
        chart.set(`${highLabel}${lowLabel}`, pairWeight(high));
        continue;
      }

      chart.set(`${highLabel}${lowLabel}s`, comboWeight(high, low, true));
      chart.set(`${highLabel}${lowLabel}o`, comboWeight(high, low, false));
    }
  }

  return chart;
}

function pairWeight(value) {
  return clamp(0.45 + (value - 2) * 0.045 + (value >= 10 ? 0.12 : 0), 0.28, 0.99);
}

function comboWeight(high, low, suited) {
  const gap = high - low;
  let weight = (high + low) / 32;

  if (suited) weight += 0.1;
  if (gap === 1) weight += 0.08;
  if (gap === 2) weight += 0.04;
  if (gap >= 5) weight -= 0.1;
  if (high >= 13 && low >= 10) weight += 0.14;
  if (high === 14 && suited) weight += 0.05;
  if (high <= 8 && gap > 3) weight -= 0.12;

  return clamp(weight, 0.04, 0.94);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
