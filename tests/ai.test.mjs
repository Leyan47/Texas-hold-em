import assert from "node:assert/strict";
import { decideAIAction } from "../ai.js";

const c = (rank, suit) => ({ rank, suit });

function withMockedRandom(values, fn) {
  const originalRandom = Math.random;
  let index = 0;
  Math.random = () => values[index++] ?? values.at(-1) ?? 0.5;

  try {
    fn();
  } finally {
    Math.random = originalRandom;
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("AI does not raise after the player is already all-in", () => {
  withMockedRandom([0.5, 0.99, 0], () => {
    const decision = decideAIAction({
      aiCards: [c("A", "spades"), c("K", "spades")],
      communityCards: [
        c("Q", "spades"),
        c("J", "spades"),
        c("10", "spades"),
        c("2", "clubs"),
        c("3", "diamonds"),
      ],
      stage: "river",
      aiChips: 1000,
      playerChips: 0,
      pot: 200,
      currentBet: 100,
      aiCurrentBet: 50,
      raiseCount: 0,
      maxRaises: 2,
      defaultBet: 50,
      raiseAmount: 100,
    });

    assert.equal(decision.action, "call");
    assert.equal(decision.amount, 50);
  });
});

test("AI reports equity and value-bet reason for a premium checked-to hand", () => {
  withMockedRandom([0.5], () => {
    const decision = decideAIAction({
      aiCards: [c("A", "spades"), c("K", "spades")],
      communityCards: [
        c("Q", "spades"),
        c("J", "spades"),
        c("10", "spades"),
        c("2", "clubs"),
        c("3", "diamonds"),
      ],
      stage: "river",
      aiChips: 1000,
      playerChips: 1000,
      pot: 240,
      currentBet: 0,
      aiCurrentBet: 0,
      raiseCount: 0,
      maxRaises: 2,
      defaultBet: 50,
      raiseAmount: 100,
    });

    assert.equal(decision.action, "bet");
    assert.equal(decision.reason, "value-bet");
    assert.equal(typeof decision.equity, "number");
    assert.ok(decision.equity > 0.95);
  });
});

test("AI uses pot odds call metadata when facing a bet and raises are unavailable", () => {
  withMockedRandom([0.5], () => {
    const decision = decideAIAction({
      aiCards: [c("A", "spades"), c("K", "spades")],
      communityCards: [
        c("Q", "spades"),
        c("J", "spades"),
        c("10", "spades"),
        c("2", "clubs"),
        c("3", "diamonds"),
      ],
      stage: "river",
      aiChips: 1000,
      playerChips: 0,
      pot: 240,
      currentBet: 100,
      aiCurrentBet: 60,
      raiseCount: 0,
      maxRaises: 2,
      defaultBet: 50,
      raiseAmount: 100,
    });

    assert.equal(decision.action, "call");
    assert.equal(decision.amount, 40);
    assert.equal(decision.reason, "pot-odds-call");
    assert.equal(typeof decision.equity, "number");
    assert.ok(decision.equity > 0.95);
  });
});
