export const SUITS = ["spades", "hearts", "diamonds", "clubs"];
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

const SUIT_SYMBOLS = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

const HAND_NAMES = {
  10: "Royal Flush",
  9: "Straight Flush",
  8: "Four of a Kind",
  7: "Full House",
  6: "Flush",
  5: "Straight",
  4: "Three of a Kind",
  3: "Two Pair",
  2: "One Pair",
  1: "High Card",
};

export function createDeck() {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
}

export function shuffleDeck(deck) {
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }

  return deck;
}

export function dealCards(deck, count) {
  if (!Array.isArray(deck)) {
    throw new TypeError("deck must be an array");
  }

  return deck.splice(0, count);
}

export function formatCard(card) {
  return `${card.rank}${SUIT_SYMBOLS[card.suit] ?? card.suit}`;
}

export function getCardValue(card) {
  return rankValue(card.rank);
}

export function isRedSuit(suit) {
  return suit === "hearts" || suit === "diamonds";
}

export function evaluateBestHand(cards) {
  if (!Array.isArray(cards) || cards.length < 5) {
    throw new Error("evaluateBestHand requires at least 5 cards");
  }

  const combinations = getCombinations(cards, 5);
  let bestHand = null;

  for (const combination of combinations) {
    const hand = evaluateFiveCardHand(combination);
    if (!bestHand || compareHands(hand, bestHand) > 0) {
      bestHand = hand;
    }
  }

  return bestHand;
}

export function compareHands(handA, handB) {
  if (handA.rank !== handB.rank) {
    return handA.rank > handB.rank ? 1 : -1;
  }

  const maxLength = Math.max(handA.tiebreakers.length, handB.tiebreakers.length);
  for (let index = 0; index < maxLength; index += 1) {
    const valueA = handA.tiebreakers[index] ?? 0;
    const valueB = handB.tiebreakers[index] ?? 0;

    if (valueA !== valueB) {
      return valueA > valueB ? 1 : -1;
    }
  }

  return 0;
}

function evaluateFiveCardHand(cards) {
  const values = cards.map(getCardValue).sort((a, b) => b - a);
  const counts = countValues(values);
  const groups = [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);

  const isFlush = cards.every((card) => card.suit === cards[0].suit);
  const straightHigh = findStraightHigh(values);

  if (isFlush && straightHigh === 14) {
    return makeHand(10, [14], cards);
  }

  if (isFlush && straightHigh) {
    return makeHand(9, [straightHigh], cards);
  }

  const four = groups.find((group) => group.count === 4);
  if (four) {
    const kicker = groups.find((group) => group.count === 1).value;
    return makeHand(8, [four.value, kicker], cards);
  }

  const trips = groups.filter((group) => group.count === 3);
  const pairs = groups.filter((group) => group.count === 2);
  if (trips.length > 0 && pairs.length > 0) {
    return makeHand(7, [trips[0].value, pairs[0].value], cards);
  }

  if (isFlush) {
    return makeHand(6, values, cards);
  }

  if (straightHigh) {
    return makeHand(5, [straightHigh], cards);
  }

  if (trips.length > 0) {
    const kickers = groups
      .filter((group) => group.count === 1)
      .map((group) => group.value)
      .sort((a, b) => b - a);
    return makeHand(4, [trips[0].value, ...kickers], cards);
  }

  if (pairs.length >= 2) {
    const sortedPairs = pairs.map((pair) => pair.value).sort((a, b) => b - a);
    const kicker = groups.find((group) => group.count === 1).value;
    return makeHand(3, [sortedPairs[0], sortedPairs[1], kicker], cards);
  }

  if (pairs.length === 1) {
    const kickers = groups
      .filter((group) => group.count === 1)
      .map((group) => group.value)
      .sort((a, b) => b - a);
    return makeHand(2, [pairs[0].value, ...kickers], cards);
  }

  return makeHand(1, values, cards);
}

function rankValue(rank) {
  if (rank === "A") return 14;
  if (rank === "K") return 13;
  if (rank === "Q") return 12;
  if (rank === "J") return 11;
  return Number(rank);
}

function countValues(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function findStraightHigh(values) {
  const uniqueValues = [...new Set(values)].sort((a, b) => b - a);
  const searchableValues = uniqueValues.includes(14)
    ? [...uniqueValues, 1]
    : uniqueValues;

  for (let start = 0; start <= searchableValues.length - 5; start += 1) {
    const window = searchableValues.slice(start, start + 5);
    const isStraight = window.every((value, index) => index === 0 || window[index - 1] - value === 1);
    if (isStraight) {
      return window[0];
    }
  }

  return 0;
}

function makeHand(rank, tiebreakers, cards) {
  return {
    rank,
    name: HAND_NAMES[rank],
    tiebreakers,
    cards: [...cards].sort((a, b) => getCardValue(b) - getCardValue(a)),
  };
}

function getCombinations(cards, count, start = 0, chosen = [], combinations = []) {
  if (chosen.length === count) {
    combinations.push([...chosen]);
    return combinations;
  }

  for (let index = start; index <= cards.length - (count - chosen.length); index += 1) {
    chosen.push(cards[index]);
    getCombinations(cards, count, index + 1, chosen, combinations);
    chosen.pop();
  }

  return combinations;
}
