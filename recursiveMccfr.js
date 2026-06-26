import {
  compareHands,
  createDeck,
  evaluateBestHand,
} from "./poker.js";
import {
  estimateEquity,
  estimatePreflopStrength,
} from "./equity.js";
import {
  buildPlayerRangeModel,
  estimateBlockerScore,
  estimateDrawPotential,
  getInformationSetKey,
} from "./rangeModel.js";
import {
  chooseActionFromFrequency,
  deriveActionFrequencies,
  normalizeFrequencies,
  regretMatchedStrategy,
} from "./actionFrequency.js";

export const MCCFR_BETTING_SIZE_SET = [0.33, 0.5, 0.75, 1];

const STAGES = ["preflop", "flop", "turn", "river"];
const NODES = ["root", "facing-bet"];
const PRESSURE_BUCKETS = ["none", "low-pressure", "pressure", "high-pressure"];
const POT_BUCKETS = ["small", "medium", "large"];
const RANGE_BUCKETS = ["wide", "neutral", "tight"];
const EQUITY_BUCKETS = ["equity-air", "equity-low", "equity-medium", "equity-high", "equity-nut"];
const DRAW_BUCKETS = ["dry", "dynamic", "wet", "draw", "blocker"];

const STARTING_STACK = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const MAX_RAISES_PER_STREET = 2;
const TRAINING_EQUITY_SAMPLES = 28;

let lastTrainingStats = emptyTrainingStats();

export function createTrainingRootState({
  seed = 1,
  rng,
  startingStack = STARTING_STACK,
  smallBlind = SMALL_BLIND,
  bigBlind = BIG_BLIND,
} = {}) {
  const random = rng ?? createSeededRandom(seed);
  const deck = shuffleWithRng(createDeck(), random);
  const playerCards = deck.slice(0, 2);
  const aiCards = deck.slice(2, 4);
  const board = deck.slice(4, 9);
  const playerBlind = Math.min(smallBlind, startingStack);
  const aiBlind = Math.min(bigBlind, startingStack);

  return {
    nodeType: "decision",
    stage: "preflop",
    toAct: "player",
    playerCards,
    aiCards,
    board,
    communityCards: [],
    playerChips: startingStack - playerBlind,
    aiChips: startingStack - aiBlind,
    pot: playerBlind + aiBlind,
    currentBet: aiBlind,
    playerCurrentBet: playerBlind,
    aiCurrentBet: aiBlind,
    raisesThisStreet: 0,
    checkedPlayers: [],
    history: [],
    startingStack,
    smallBlind,
    bigBlind,
    lastTransition: "root",
  };
}

export function getTrainingLegalActions(state) {
  if (!state || state.nodeType === "terminal") {
    return [];
  }

  const actor = state.toAct;
  const toCall = getTrainingToCall(state);
  const actorChips = getStack(state, actor);
  const opponentChips = getStack(state, opponentOf(actor));

  if (actorChips <= 0 || opponentChips <= 0) {
    return ["check"];
  }

  if (toCall > 0) {
    const actions = ["fold", "call"];
    const canRaise = state.raisesThisStreet < MAX_RAISES_PER_STREET
      && actorChips > toCall
      && opponentChips > 0;

    if (canRaise) {
      actions.push("raise");
    }

    return actions;
  }

  return ["check", "bet"];
}

export function applyTrainingAction(state, action) {
  const legalActions = getTrainingLegalActions(state);

  if (!legalActions.includes(action)) {
    throw new Error(`Illegal training action: ${action}`);
  }

  if (action === "fold") {
    return makeTerminalState({
      ...cloneTrainingState(state),
      winner: opponentOf(state.toAct),
      terminalReason: "fold",
      history: appendHistory(state, action),
      lastTransition: "terminal",
    });
  }

  if (action === "call") {
    const actor = state.toAct;
    const committed = commitChips(cloneTrainingState(state), actor, getTrainingToCall(state));
    const next = {
      ...committed,
      history: appendHistory(state, action),
    };

    if (isAllIn(next)) {
      return runOutToShowdown(next);
    }

    return advanceTrainingStage(next);
  }

  if (action === "check") {
    const actor = state.toAct;
    const checkedPlayers = [...new Set([...state.checkedPlayers, actor])];
    const next = {
      ...cloneTrainingState(state),
      checkedPlayers,
      history: appendHistory(state, action),
      lastTransition: "action",
    };

    if (checkedPlayers.length >= 2) {
      return advanceTrainingStage(next);
    }

    return {
      ...next,
      toAct: opponentOf(actor),
    };
  }

  if (action === "bet" || action === "raise") {
    const actor = state.toAct;
    const toCall = getTrainingToCall(state);
    const wager = chooseTrainingWager(state, action);
    const committed = commitChips(cloneTrainingState(state), actor, toCall + wager);
    const next = {
      ...committed,
      toAct: opponentOf(actor),
      checkedPlayers: [],
      raisesThisStreet: state.raisesThisStreet + 1,
      history: appendHistory(state, action, toCall + wager),
      lastTransition: "action",
    };

    if (isAllIn(next)) {
      return runOutToShowdown(next);
    }

    return next;
  }

  throw new Error(`Unsupported training action: ${action}`);
}

export function evaluateTrainingTerminalUtility(state) {
  if (!state || state.nodeType !== "terminal") {
    throw new Error("evaluateTrainingTerminalUtility requires a terminal state");
  }

  if (state.terminalReason === "fold") {
    return normalizeUtility(state.winner === "ai" ? state.pot : -state.pot, state);
  }

  const aiHand = evaluateBestHand([...state.aiCards, ...state.communityCards]);
  const playerHand = evaluateBestHand([...state.playerCards, ...state.communityCards]);
  const result = compareHands(aiHand, playerHand);

  if (result === 0) {
    return 0;
  }

  return normalizeUtility(result > 0 ? state.pot : -state.pot, state);
}

export function getLastTrainingStats() {
  return { ...lastTrainingStats };
}

export function trainRecursiveMCCFR({
  iterations = 160,
  seed = 1,
  includeFallbackInformationSets = true,
} = {}) {
  const regretTable = new Map();
  const strategySums = new Map();
  const rng = createSeededRandom(seed);
  const stats = emptyTrainingStats({
    iterations,
    bettingSizes: [...MCCFR_BETTING_SIZE_SET],
  });

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const root = createTrainingRootState({ rng });

    stats.rootDeals += 1;
    traverseMCCFR(root, "ai", regretTable, strategySums, rng, stats);
    traverseMCCFR(root, "player", regretTable, strategySums, rng, stats);
  }

  const table = averageStrategyTable(strategySums);

  if (includeFallbackInformationSets) {
    fillFallbackInformationSets(table);
  }

  stats.informationSetCount = table.size;
  lastTrainingStats = stats;
  return table;
}

function traverseMCCFR(state, traverser, regretTable, strategySums, rng, stats) {
  if (state.nodeType === "terminal") {
    stats.terminalEvaluations += 1;
    return evaluateTrainingTerminalUtility(state);
  }

  stats.decisionNodesVisited += 1;

  const legalActions = getTrainingLegalActions(state);
  if (legalActions.length === 0) {
    const terminal = runOutToShowdown(state);
    stats.terminalEvaluations += 1;
    return evaluateTrainingTerminalUtility(terminal);
  }

  const infoSetKey = getTrainingInformationSetKey(state, rng);
  ensureRegretRow(regretTable, infoSetKey, legalActions);
  ensureRegretRow(strategySums, infoSetKey, legalActions);

  const regrets = regretTable.get(infoSetKey);
  const strategy = regretMatchedStrategy(regrets, legalActions);
  addStrategySum(strategySums, infoSetKey, legalActions, strategy);

  if (state.toAct !== traverser) {
    const sampledAction = chooseActionFromFrequency(strategy, rng());
    const child = applyTrainingAction(state, sampledAction);
    countChanceTransition(child, stats);
    return traverseMCCFR(child, traverser, regretTable, strategySums, rng, stats);
  }

  const actionUtilities = {};
  let nodeUtilityForActor = 0;

  for (const action of legalActions) {
    const child = applyTrainingAction(state, action);
    countChanceTransition(child, stats);
    const utilityForAi = traverseMCCFR(child, traverser, regretTable, strategySums, rng, stats);
    const utilityForActor = state.toAct === "ai" ? utilityForAi : -utilityForAi;

    actionUtilities[action] = utilityForActor;
    nodeUtilityForActor += strategy[action] * utilityForActor;
  }

  for (const action of legalActions) {
    regrets[action] += actionUtilities[action] - nodeUtilityForActor;
  }

  return state.toAct === "ai" ? nodeUtilityForActor : -nodeUtilityForActor;
}

function getTrainingInformationSetKey(state, rng) {
  const actorCards = state.toAct === "ai" ? state.aiCards : state.playerCards;
  const actorBet = getStreetBet(state, state.toAct);
  const opponentBet = getStreetBet(state, opponentOf(state.toAct));
  const pseudoGameState = {
    aiCards: actorCards,
    communityCards: state.communityCards,
    stage: state.stage,
    pot: state.pot,
    currentBet: Math.max(actorBet, opponentBet),
    aiCurrentBet: actorBet,
    playerCurrentBet: opponentBet,
  };
  const rangeModel = buildPlayerRangeModel(pseudoGameState);
  const equity = estimateTrainingEquity(actorCards, pseudoGameState, rangeModel, rng);
  const drawScore = estimateDrawPotential(actorCards, state.communityCards);
  const blockerScore = estimateBlockerScore(actorCards, state.communityCards);

  return getInformationSetKey({
    gameState: pseudoGameState,
    equity,
    drawScore,
    blockerScore,
    rangeModel,
  });
}

function estimateTrainingEquity(cards, gameState, rangeModel, rng) {
  if (gameState.communityCards.length < 3) {
    return estimatePreflopStrength(cards);
  }

  if (!rng) {
    return estimateEquity({
      aiCards: cards,
      communityCards: gameState.communityCards,
      stage: gameState.stage,
      samples: TRAINING_EQUITY_SAMPLES,
      opponentRangeModel: rangeModel,
    });
  }

  return withRandomSource(rng, () => estimateEquity({
    aiCards: cards,
    communityCards: gameState.communityCards,
    stage: gameState.stage,
    samples: TRAINING_EQUITY_SAMPLES,
    opponentRangeModel: rangeModel,
  }));
}

function advanceTrainingStage(state) {
  if (state.stage === "river") {
    return makeTerminalState({
      ...cloneTrainingState(state),
      communityCards: state.board.slice(0, 5),
      terminalReason: "showdown",
      winner: null,
      lastTransition: "terminal",
    });
  }

  const nextStage = STAGES[STAGES.indexOf(state.stage) + 1];
  const cardCount = nextStage === "flop" ? 3 : nextStage === "turn" ? 4 : 5;

  return {
    ...cloneTrainingState(state),
    nodeType: "decision",
    stage: nextStage,
    toAct: "ai",
    communityCards: state.board.slice(0, cardCount),
    currentBet: 0,
    playerCurrentBet: 0,
    aiCurrentBet: 0,
    raisesThisStreet: 0,
    checkedPlayers: [],
    history: [
      ...state.history,
      { type: "deal", stage: nextStage, cards: cardCount },
    ],
    lastTransition: "chance",
  };
}

function runOutToShowdown(state) {
  return makeTerminalState({
    ...cloneTrainingState(state),
    communityCards: state.board.slice(0, 5),
    terminalReason: "showdown",
    winner: null,
    history: [
      ...state.history,
      { type: "deal", stage: "runout", cards: 5 },
    ],
    lastTransition: "chance-terminal",
  });
}

function makeTerminalState(state) {
  return {
    ...state,
    nodeType: "terminal",
    toAct: null,
  };
}

function commitChips(state, actor, amount) {
  const stackKey = actor === "ai" ? "aiChips" : "playerChips";
  const betKey = actor === "ai" ? "aiCurrentBet" : "playerCurrentBet";
  const committed = Math.min(Math.max(0, Math.round(amount)), state[stackKey]);

  return {
    ...state,
    [stackKey]: state[stackKey] - committed,
    [betKey]: state[betKey] + committed,
    pot: state.pot + committed,
    currentBet: Math.max(state.currentBet, state[betKey] + committed),
  };
}

function chooseTrainingWager(state, action) {
  const actor = state.toAct;
  const potBasis = Math.max(state.pot + getTrainingToCall(state), state.bigBlind);
  const sizeIndex = Math.min(
    MCCFR_BETTING_SIZE_SET.length - 1,
    (state.history.length + (action === "raise" ? 1 : 0)) % MCCFR_BETTING_SIZE_SET.length
  );
  const fraction = MCCFR_BETTING_SIZE_SET[sizeIndex];
  const minimum = action === "raise" ? state.bigBlind : state.bigBlind;
  const wager = Math.max(minimum, roundTo10(potBasis * fraction));

  return Math.min(wager, getStack(state, actor));
}

function getTrainingToCall(state) {
  if (!state?.toAct) {
    return 0;
  }

  const actorBet = getStreetBet(state, state.toAct);
  return Math.max(0, state.currentBet - actorBet);
}

function getStreetBet(state, actor) {
  return actor === "ai" ? state.aiCurrentBet : state.playerCurrentBet;
}

function getStack(state, actor) {
  return actor === "ai" ? state.aiChips : state.playerChips;
}

function opponentOf(actor) {
  return actor === "ai" ? "player" : "ai";
}

function isAllIn(state) {
  return state.aiChips <= 0 || state.playerChips <= 0;
}

function appendHistory(state, action, amount = 0) {
  return [
    ...state.history,
    {
      type: "action",
      actor: state.toAct,
      action,
      amount,
      stage: state.stage,
    },
  ];
}

function cloneTrainingState(state) {
  return {
    ...state,
    playerCards: [...state.playerCards],
    aiCards: [...state.aiCards],
    board: [...state.board],
    communityCards: [...state.communityCards],
    checkedPlayers: [...state.checkedPlayers],
    history: [...state.history],
  };
}

function normalizeUtility(value, state) {
  return value / Math.max(state.startingStack ?? STARTING_STACK, 1);
}

function ensureRegretRow(table, key, legalActions) {
  if (!table.has(key)) {
    table.set(key, Object.fromEntries(legalActions.map((action) => [action, 0])));
    return;
  }

  const row = table.get(key);
  for (const action of legalActions) {
    if (!(action in row)) {
      row[action] = 0;
    }
  }
}

function addStrategySum(strategySums, key, legalActions, strategy) {
  const row = strategySums.get(key);
  for (const action of legalActions) {
    row[action] += strategy[action] ?? 0;
  }
}

function averageStrategyTable(strategySums) {
  const table = new Map();

  for (const [key, sums] of strategySums.entries()) {
    table.set(key, normalizeFrequencies(sums));
  }

  return table;
}

function fillFallbackInformationSets(table) {
  for (const key of buildFallbackInformationSetKeys()) {
    if (!table.has(key)) {
      table.set(key, fallbackFrequenciesForKey(key));
    }
  }
}

function buildFallbackInformationSetKeys() {
  const informationSets = [];

  for (const stage of STAGES) {
    for (const node of NODES) {
      for (const pressure of PRESSURE_BUCKETS) {
        if (node === "root" && pressure !== "none") continue;
        if (node === "facing-bet" && pressure === "none") continue;

        for (const pot of POT_BUCKETS) {
          for (const range of RANGE_BUCKETS) {
            for (const equity of EQUITY_BUCKETS) {
              for (const texture of DRAW_BUCKETS) {
                informationSets.push(`${stage}|${node}|${pressure}|${pot}|range-${range}|${equity}|${texture}`);
                informationSets.push(`${stage}|${node}|${pressure}|${pot}|${range}|${equity}|${texture}`);
              }
            }
          }
        }
      }
    }
  }

  return informationSets;
}

function fallbackFrequenciesForKey(key) {
  const parts = key.split("|");
  const stage = parts[0];
  const node = parts[1];
  const pressureBucket = parts[2];
  const equityBucket = parts[5];
  const drawBucket = parts[6];

  return deriveActionFrequencies({
    stage,
    node,
    equityBucket,
    pressureBucket,
    drawBucket,
  });
}

function countChanceTransition(state, stats) {
  if (state.lastTransition === "chance" || state.lastTransition === "chance-terminal") {
    stats.chanceNodesVisited += 1;
  }
}

function emptyTrainingStats(overrides = {}) {
  return {
    mode: "recursive-mccfr",
    iterations: 0,
    rootDeals: 0,
    decisionNodesVisited: 0,
    chanceNodesVisited: 0,
    terminalEvaluations: 0,
    informationSetCount: 0,
    bettingSizes: [...MCCFR_BETTING_SIZE_SET],
    ...overrides,
  };
}

function shuffleWithRng(deck, rng) {
  const copy = [...deck];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}

function createSeededRandom(seed) {
  let state = normalizeSeed(seed);

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function normalizeSeed(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) {
    return seed >>> 0;
  }

  const text = String(seed ?? "1");
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function withRandomSource(rng, fn) {
  const originalRandom = Math.random;
  Math.random = rng;

  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

function roundTo10(value) {
  return Math.round(value / 10) * 10;
}
