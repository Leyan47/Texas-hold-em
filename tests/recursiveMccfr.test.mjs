import assert from "node:assert/strict";
import {
  applyTrainingAction,
  createTrainingRootState,
  evaluateTrainingTerminalUtility,
  getLastTrainingStats,
  getTrainingLegalActions,
  trainMCCFRStrategy,
} from "../solverLikeStrategy.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("training root is a preflop decision node with facing-bet actions", () => {
  const state = createTrainingRootState({ seed: 11 });
  const actions = getTrainingLegalActions(state);

  assert.equal(state.nodeType, "decision");
  assert.equal(state.stage, "preflop");
  assert.equal(state.toAct, "player");
  assert.ok(actions.includes("fold"));
  assert.ok(actions.includes("call"));
  assert.ok(actions.includes("raise"));
});

test("fold transition creates a terminal node with AI-positive utility", () => {
  const state = createTrainingRootState({ seed: 12 });
  const terminal = applyTrainingAction(state, "fold");

  assert.equal(terminal.nodeType, "terminal");
  assert.equal(terminal.terminalReason, "fold");
  assert.equal(terminal.winner, "ai");
  assert.ok(evaluateTrainingTerminalUtility(terminal) > 0);
});

test("call and check actions advance chance runout to showdown", () => {
  let state = createTrainingRootState({ seed: 13 });

  state = applyTrainingAction(state, "call");
  assert.equal(state.stage, "flop");
  assert.equal(state.communityCards.length, 3);

  for (const action of ["check", "check", "check", "check", "check", "check"]) {
    assert.ok(getTrainingLegalActions(state).includes(action));
    state = applyTrainingAction(state, action);
  }

  assert.equal(state.nodeType, "terminal");
  assert.equal(state.terminalReason, "showdown");
  assert.equal(state.communityCards.length, 5);
  assert.equal(typeof evaluateTrainingTerminalUtility(state), "number");
});

test("MCCFR trainer records recursive traversal stats", () => {
  const table = trainMCCFRStrategy({ iterations: 4, seed: 21 });
  const stats = getLastTrainingStats();

  assert.ok(table.size > 0);
  assert.equal(stats.mode, "recursive-mccfr");
  assert.ok(stats.decisionNodesVisited > 0);
  assert.ok(stats.chanceNodesVisited > 0);
  assert.ok(stats.terminalEvaluations > 0);
  assert.ok(table.get("preflop|root|none|medium|neutral|equity-medium|dry"));
});
