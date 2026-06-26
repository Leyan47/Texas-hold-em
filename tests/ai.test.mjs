import assert from "node:assert/strict";
import { decideAIAction } from "../ai.js";
import {
  BETTING_SIZE_SET,
  buildAbstractGameTree,
  getSolverStrategyTable,
  setSolverStrategyTable,
} from "../solverLikeStrategy.js";
import {
  getPreflopHandKey,
  getPreflopRangeWeight,
} from "../preflopCharts.js";
import { estimateEquity } from "../equity.js";
import {
  buildPlayerRangeModel,
  getInformationSetKey,
} from "../rangeModel.js";
import {
  chooseActionFromFrequency,
  normalizeFrequencies,
} from "../actionFrequency.js";

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

test("AI does not turn pure trash into a bluff raise without draw or blockers", () => {
  setSolverStrategyTable(new Map());

  try {
    withMockedRandom([0.5, 0.99], () => {
      const decision = decideAIAction({
        aiCards: [c("7", "clubs"), c("2", "diamonds")],
        communityCards: [],
        stage: "preflop",
        aiChips: 1000,
        playerChips: 1000,
        pot: 100,
        currentBet: 500,
        aiCurrentBet: 0,
        playerCurrentBet: 500,
        raiseCount: 0,
        maxRaises: 2,
        defaultBet: 50,
        raiseAmount: 100,
      });

      assert.equal(decision.action, "fold");
      assert.notEqual(decision.reason, "bluff-raise");
    });
  } finally {
    setSolverStrategyTable(null);
  }
});

test("preflop chart ranks premium pairs above weak offsuit hands", () => {
  const aces = [c("A", "spades"), c("A", "hearts")];
  const sevenTwo = [c("7", "clubs"), c("2", "diamonds")];

  assert.equal(getPreflopHandKey(aces), "AA");
  assert.equal(getPreflopHandKey(sevenTwo), "72o");
  assert.ok(getPreflopRangeWeight(aces) > getPreflopRangeWeight(sevenTwo));
});

test("equity module estimates a made royal flush as nearly unbeatable", () => {
  withMockedRandom([0.5], () => {
    const equity = estimateEquity({
      aiCards: [c("A", "spades"), c("K", "spades")],
      communityCards: [
        c("Q", "spades"),
        c("J", "spades"),
        c("10", "spades"),
        c("2", "clubs"),
        c("3", "diamonds"),
      ],
      stage: "river",
      samples: 40,
    });

    assert.ok(equity > 0.95);
  });
});

test("range model creates stable information set keys", () => {
  const state = {
    aiCards: [c("A", "spades"), c("K", "spades")],
    communityCards: [c("Q", "spades"), c("J", "clubs"), c("2", "diamonds")],
    stage: "flop",
    pot: 180,
    currentBet: 60,
    aiCurrentBet: 20,
    playerCurrentBet: 60,
  };

  const rangeModel = buildPlayerRangeModel(state);
  const key = getInformationSetKey({
    gameState: state,
    equity: 0.62,
    drawScore: 0.28,
    blockerScore: 0.2,
    rangeModel,
  });

  assert.match(key, /^flop\|/);
  assert.match(key, /range-/);
  assert.match(key, /equity-/);
});

test("abstract solver produces action frequencies for game-tree information sets", () => {
  const tree = buildAbstractGameTree();
  const table = getSolverStrategyTable();
  const rootFrequencies = table.get("preflop|root|none|medium|neutral|equity-medium|dry");

  assert.deepEqual(BETTING_SIZE_SET, [0.33, 0.5, 0.75, 1]);
  assert.ok(tree.stages.includes("preflop"));
  assert.ok(tree.stages.includes("river"));
  assert.ok(rootFrequencies);

  const total = Object.values(rootFrequencies).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 1) < 0.000001);
});

test("action frequency helper normalizes and samples mixed strategies", () => {
  const frequencies = normalizeFrequencies({ check: 2, bet: 1, fold: 0 });
  const action = chooseActionFromFrequency(frequencies, 0.8);

  assert.equal(frequencies.check, 2 / 3);
  assert.equal(frequencies.bet, 1 / 3);
  assert.equal(action, "bet");
});
