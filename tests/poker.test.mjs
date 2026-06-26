import assert from "node:assert/strict";
import {
  compareHands,
  createDeck,
  evaluateBestHand,
  formatCard,
} from "../poker.js";

const c = (rank, suit) => ({ rank, suit });

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("createDeck builds 52 unique cards", () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map(formatCard)).size, 52);
});

test("evaluateBestHand finds a royal flush from seven cards", () => {
  const hand = evaluateBestHand([
    c("A", "spades"),
    c("K", "spades"),
    c("Q", "spades"),
    c("J", "spades"),
    c("10", "spades"),
    c("2", "clubs"),
    c("3", "diamonds"),
  ]);

  assert.equal(hand.name, "Royal Flush");
  assert.deepEqual(hand.tiebreakers, [14]);
});

test("evaluateBestHand treats A as low in a wheel straight", () => {
  const hand = evaluateBestHand([
    c("A", "hearts"),
    c("2", "clubs"),
    c("3", "diamonds"),
    c("4", "spades"),
    c("5", "hearts"),
    c("9", "clubs"),
    c("K", "diamonds"),
  ]);

  assert.equal(hand.name, "Straight");
  assert.deepEqual(hand.tiebreakers, [5]);
});

test("evaluateBestHand chooses the best full house from two trips", () => {
  const hand = evaluateBestHand([
    c("K", "hearts"),
    c("K", "clubs"),
    c("K", "diamonds"),
    c("Q", "spades"),
    c("Q", "hearts"),
    c("Q", "clubs"),
    c("2", "diamonds"),
  ]);

  assert.equal(hand.name, "Full House");
  assert.deepEqual(hand.tiebreakers, [13, 12]);
});

test("compareHands uses kickers when both players have one pair", () => {
  const pairWithAce = evaluateBestHand([
    c("9", "hearts"),
    c("9", "clubs"),
    c("A", "diamonds"),
    c("K", "spades"),
    c("7", "hearts"),
    c("4", "clubs"),
    c("2", "diamonds"),
  ]);
  const pairWithQueen = evaluateBestHand([
    c("9", "diamonds"),
    c("9", "spades"),
    c("Q", "diamonds"),
    c("K", "clubs"),
    c("7", "clubs"),
    c("4", "hearts"),
    c("2", "spades"),
  ]);

  assert.equal(compareHands(pairWithAce, pairWithQueen), 1);
});
