import {
  chooseActionFromFrequency,
  chooseBetSize,
  chooseRaiseExtra,
  deriveActionFrequencies,
  normalizeFrequencies,
} from "./actionFrequency.js";
import {
  estimateEquity,
  estimatePreflopStrength,
} from "./equity.js";
import {
  analyzeBoardTexture,
  bucketEquity,
  buildPlayerRangeModel,
  bucketPot,
  bucketToCall,
  estimateBlockerScore,
  estimateDrawPotential,
  getInformationSetKey,
} from "./rangeModel.js";
import {
  applyTrainingAction,
  createTrainingRootState,
  evaluateTrainingTerminalUtility,
  getLastTrainingStats,
  getTrainingLegalActions,
  trainRecursiveMCCFR,
} from "./recursiveMccfr.js";

export const BETTING_SIZE_SET = [0.33, 0.5, 0.75, 1];

export {
  applyTrainingAction,
  createTrainingRootState,
  evaluateTrainingTerminalUtility,
  getLastTrainingStats,
  getTrainingLegalActions,
};

const STAGES = ["preflop", "flop", "turn", "river"];
const NODES = ["root", "facing-bet"];
const PRESSURE_BUCKETS = ["none", "low-pressure", "pressure", "high-pressure"];
const POT_BUCKETS = ["small", "medium", "large"];
const RANGE_BUCKETS = ["wide", "neutral", "tight"];
const EQUITY_BUCKETS = ["equity-air", "equity-low", "equity-medium", "equity-high", "equity-nut"];
const DRAW_BUCKETS = ["dry", "dynamic", "wet", "draw", "blocker"];

const STAGE_THRESHOLDS = {
  preflop: { valueBet: 0.58, valueRaise: 0.68, thinValue: 0.52 },
  flop: { valueBet: 0.62, valueRaise: 0.72, thinValue: 0.55 },
  turn: { valueBet: 0.65, valueRaise: 0.75, thinValue: 0.58 },
  river: { valueBet: 0.67, valueRaise: 0.78, thinValue: 0.6 },
};

let solverStrategyTable;
let solverStrategySource = "generated-fallback";

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

  const rangeModel = buildPlayerRangeModel(gameState);
  const equity = estimateEquity({
    aiCards,
    communityCards,
    stage,
    opponentRangeModel: rangeModel,
  });
  const drawScore = estimateDrawPotential(aiCards, communityCards);
  const blockerScore = estimateBlockerScore(aiCards, communityCards);
  const boardTexture = analyzeBoardTexture(communityCards);
  const mixedEquity = clamp(
    equity + drawScore * 0.06 + blockerScore * 0.03 + randomBetween(-0.015, 0.015),
    0,
    1
  );
  const infoSetKey = getInformationSetKey({
    gameState,
    equity: mixedEquity,
    drawScore,
    blockerScore,
    rangeModel,
  });
  const frequencies = getRuntimeFrequencies(infoSetKey, {
    stage,
    toCall,
    pot,
    canRaise,
    mixedEquity,
    drawScore,
    blockerScore,
    boardTexture,
  });

  if (toCall > 0) {
    return decideFacingBet({
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
      frequencies,
      infoSetKey,
    });
  }

  return decideWhenCheckedTo({
    gameState,
    stage,
    equity,
    mixedEquity,
    drawScore,
    blockerScore,
    boardTexture,
    frequencies,
    infoSetKey,
  });
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

  return estimateEquity({ aiCards, communityCards, stage });
}

export function buildAbstractGameTree() {
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

  return {
    stages: [...STAGES],
    bettingSizes: [...BETTING_SIZE_SET],
    nodes: {
      root: ["check", "bet"],
      "facing-bet": ["fold", "call", "raise"],
    },
    informationSets,
  };
}

export function getSolverStrategyTable() {
  if (!solverStrategyTable) {
    solverStrategyTable = trainMCCFRStrategy({ iterations: 160 });
    solverStrategySource = "generated-fallback";
  }

  return solverStrategyTable;
}

export function setSolverStrategyTable(table, source = "external-file") {
  solverStrategyTable = table;
  solverStrategySource = table ? source : "generated-fallback";
}

export function getSolverStrategySource() {
  return solverStrategySource;
}

export async function loadStrategyFile(url = "strategy.json") {
  if (typeof fetch !== "function") {
    return false;
  }

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return false;
    }

    const payload = await response.json();
    setSolverStrategyTable(hydrateStrategyTable(payload), url);
    return true;
  } catch {
    return false;
  }
}

export function serializeStrategyTable(table, {
  iterations = 0,
  generatedAt = new Date().toISOString(),
  trainingStats = getLastTrainingStats(),
} = {}) {
  const strategy = {};
  const sortedEntries = [...table.entries()].sort(([keyA], [keyB]) => keyA.localeCompare(keyB));

  for (const [key, frequencies] of sortedEntries) {
    strategy[key] = hydrateFrequencies(frequencies);
  }

  return {
    version: 1,
    generatedAt,
    iterations,
    trainingMode: trainingStats?.mode ?? "recursive-mccfr",
    trainingStats,
    bettingSizes: [...BETTING_SIZE_SET],
    informationSetCount: sortedEntries.length,
    strategy,
  };
}

export function hydrateStrategyTable(payload) {
  if (!payload || payload.version !== 1 || !payload.strategy || typeof payload.strategy !== "object") {
    throw new Error("Invalid strategy payload");
  }

  const table = new Map();

  for (const [key, frequencies] of Object.entries(payload.strategy)) {
    table.set(key, hydrateFrequencies(frequencies));
  }

  return table;
}

export function trainMCCFRStrategy(options = {}) {
  return trainRecursiveMCCFR(options);
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
    frequencies,
    infoSetKey,
  } = info;

  const thresholds = STAGE_THRESHOLDS[stage];
  const potOdds = toCall / (pot + toCall);
  const mdf = pot / (pot + toCall);
  const isValueRaise = mixedEquity >= thresholds.valueRaise;
  const isCredibleBluffRaise = canUseBluffRaiseCandidate({
    stage,
    mixedEquity,
    potOdds,
    drawScore,
    blockerScore,
  });

  if (!canRaise && mixedEquity >= potOdds) {
    return {
      action: "call",
      amount: Math.min(chips, toCall),
      strength: equity,
      equity,
      reason: "pot-odds-call",
      infoSetKey,
      actionFrequencies: normalizeFrequencies({ call: 1 }),
    };
  }

  const action = chooseActionFromFrequency(filterRaiseFrequency(frequencies, canRaise));

  if (action === "raise" && canRaise && (isValueRaise || isCredibleBluffRaise)) {
    const purpose = isValueRaise ? "value" : "bluff";
    return {
      action: "raise",
      amount: Math.min(chips, toCall + chooseRaiseExtra(gameState, boardTexture, purpose, BETTING_SIZE_SET)),
      strength: equity,
      equity,
      reason: purpose === "value" ? "value-raise" : "bluff-raise",
      infoSetKey,
      actionFrequencies: frequencies,
    };
  }

  if (action === "call" || mixedEquity >= potOdds || mixedEquity >= mdf * 0.55) {
    return {
      action: "call",
      amount: Math.min(chips, toCall),
      strength: equity,
      equity,
      reason: "pot-odds-call",
      infoSetKey,
      actionFrequencies: frequencies,
    };
  }

  return {
    action: "fold",
    amount: 0,
    strength: equity,
    equity,
    reason: drawScore > 0.25 || blockerScore > 0.2 ? "mixed-frequency-fold" : "fold-below-threshold",
    infoSetKey,
    actionFrequencies: frequencies,
  };
}

function canUseBluffRaiseCandidate({
  stage,
  mixedEquity,
  potOdds,
  drawScore,
  blockerScore,
}) {
  if (stage === "river") {
    return blockerScore >= 0.22 && mixedEquity >= 0.16;
  }

  return drawScore >= 0.25
    || blockerScore >= 0.2
    || mixedEquity >= Math.max(0.34, potOdds - 0.08);
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
    frequencies,
    infoSetKey,
  } = info;
  const thresholds = STAGE_THRESHOLDS[stage];
  const action = chooseActionFromFrequency(frequencies);
  const isStrongValue = mixedEquity >= thresholds.valueBet;
  const isSemiBluff = stage !== "river" && mixedEquity < thresholds.valueBet && drawScore >= 0.25;
  const isRiverBluff = stage === "river" && mixedEquity < 0.48 && blockerScore >= 0.2;
  const isThinValue = mixedEquity >= thresholds.thinValue && mixedEquity < thresholds.valueBet;

  if (action === "bet" || isStrongValue) {
    const purpose = isStrongValue
      ? "value"
      : isSemiBluff
        ? "semi-bluff"
        : isRiverBluff
          ? "bluff"
          : isThinValue
            ? "thin-value"
            : "bluff";

    return {
      action: "bet",
      amount: chooseBetSize(gameState, boardTexture, purpose, BETTING_SIZE_SET),
      strength: equity,
      equity,
      reason: purpose === "value" ? "value-bet" : purpose,
      infoSetKey,
      actionFrequencies: frequencies,
    };
  }

  return {
    action: "check",
    amount: 0,
    strength: equity,
    equity,
    reason: "range-check",
    infoSetKey,
    actionFrequencies: frequencies,
  };
}

function getRuntimeFrequencies(infoSetKey, info) {
  const table = getSolverStrategyTable();
  const fallbackKey = fallbackInformationSetKey(info);
  const tableFrequencies = table.get(infoSetKey) ?? table.get(fallbackKey);

  if (tableFrequencies) {
    return tableFrequencies;
  }

  return deriveActionFrequencies({
    stage: info.stage,
    node: info.toCall > 0 ? "facing-bet" : "root",
    equityBucket: bucketEquity(info.mixedEquity),
    pressureBucket: bucketToCall(info.toCall, info.pot),
    drawBucket: info.drawScore >= 0.25
      ? "draw"
      : info.blockerScore >= 0.2
        ? "blocker"
        : info.boardTexture.bucket,
  });
}

function fallbackInformationSetKey(info) {
  const node = info.toCall > 0 ? "facing-bet" : "root";
  const pressure = bucketToCall(info.toCall, info.pot);
  const pot = bucketPot(info.pot);
  const equity = bucketEquity(info.mixedEquity);
  const texture = info.drawScore >= 0.25
    ? "draw"
    : info.blockerScore >= 0.2
      ? "blocker"
      : info.boardTexture.bucket;

  return `${info.stage}|${node}|${pressure}|${pot}|neutral|${equity}|${texture}`;
}

function hydrateFrequencies(frequencies) {
  if (!frequencies || typeof frequencies !== "object") {
    return normalizeFrequencies({});
  }

  const entries = Object.entries(frequencies)
    .filter(([, value]) => Number.isFinite(value) && value >= 0);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);

  if (entries.length > 0 && Math.abs(total - 1) < 1e-9) {
    return Object.fromEntries(entries);
  }

  return normalizeFrequencies(Object.fromEntries(entries));
}

function filterRaiseFrequency(frequencies, canRaise) {
  if (canRaise) {
    return frequencies;
  }

  return normalizeFrequencies({
    fold: frequencies.fold ?? 0,
    call: frequencies.call ?? 0,
  });
}

function normalizeStage(stage) {
  const normalized = String(stage ?? "preflop").toLowerCase();
  return STAGES.includes(normalized) ? normalized : "preflop";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}
