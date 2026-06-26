export function normalizeFrequencies(frequencies) {
  const entries = Object.entries(frequencies).filter(([, value]) => value > 0);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);

  if (total <= 0) {
    const actions = Object.keys(frequencies);
    const share = actions.length ? 1 / actions.length : 0;
    return Object.fromEntries(actions.map((action) => [action, share]));
  }

  return Object.fromEntries(Object.keys(frequencies).map((action) => [
    action,
    Math.max(0, frequencies[action]) / total,
  ]));
}

export function chooseActionFromFrequency(frequencies, randomValue = Math.random()) {
  let cumulative = 0;
  const entries = Object.entries(normalizeFrequencies(frequencies));

  for (const [action, frequency] of entries) {
    cumulative += frequency;
    if (randomValue <= cumulative) {
      return action;
    }
  }

  return entries.at(-1)?.[0] ?? "check";
}

export function regretMatchedStrategy(regrets, legalActions) {
  const positiveRegrets = Object.fromEntries(
    legalActions.map((action) => [action, Math.max(0, regrets[action] ?? 0)])
  );

  return normalizeFrequencies(positiveRegrets);
}

export function calculateCallProbability({
  equity,
  potOdds,
  mdf,
  drawScore,
  blockerScore,
  stage,
}) {
  const surplus = equity - potOdds;
  let probability = sigmoid(surplus * 13);

  if (stage !== "river") probability += drawScore * 0.12;
  if (stage === "river") probability += blockerScore * 0.05;
  probability += clamp(mdf - 0.5, 0, 0.18);

  if (equity >= 0.82) probability = Math.max(probability, 0.92);
  if (equity < potOdds - 0.18) probability = Math.min(probability, 0.12);

  return clamp(probability, 0.02, 0.98);
}

export function chooseBetSize(gameState, boardTexture, purpose, bettingSizes) {
  const chips = gameState.aiChips ?? 0;
  const pot = Math.max(gameState.pot ?? 0, 1);
  const defaultBet = gameState.defaultBet ?? 50;
  const stage = normalizeStage(gameState.stage);
  const size = chooseSizeFraction(stage, boardTexture, purpose, bettingSizes);

  return clampAmount(roundTo10(Math.max(defaultBet, pot * size)), chips);
}

export function chooseRaiseExtra(gameState, boardTexture, purpose, bettingSizes) {
  const chips = gameState.aiChips ?? 0;
  const pot = Math.max(gameState.pot ?? 0, 1);
  const defaultRaise = gameState.raiseAmount ?? 100;
  const stage = normalizeStage(gameState.stage);
  const size = chooseSizeFraction(stage, boardTexture, purpose, bettingSizes);

  return clampAmount(roundTo10(Math.max(defaultRaise, pot * size)), chips);
}

export function deriveActionFrequencies({
  stage,
  node,
  equityBucket,
  pressureBucket,
  drawBucket,
}) {
  const facingBet = node === "facing-bet";
  const equityScore = equityBucketScore(equityBucket);
  const hasDrawLeverage = drawBucket === "draw" || drawBucket === "blocker";
  const highPressure = pressureBucket === "high-pressure";

  if (facingBet) {
    return normalizeFrequencies({
      fold: highPressure ? 1.5 - equityScore : 0.8 - equityScore * 0.5,
      call: 0.5 + equityScore + (hasDrawLeverage ? 0.2 : 0),
      raise: equityScore > 0.65 || hasDrawLeverage ? equityScore * 0.65 : 0.05,
    });
  }

  return normalizeFrequencies({
    check: 0.8 - equityScore * 0.45,
    bet: equityScore * 0.9 + (hasDrawLeverage ? 0.25 : 0),
  });
}

function chooseSizeFraction(stage, boardTexture, purpose, bettingSizes) {
  if (stage === "preflop") return 0.5;
  if (purpose === "thin-value") return 0.33;
  if (purpose === "bluff") return stage === "river" ? 0.75 : 0.5;
  if (purpose === "semi-bluff") return boardTexture.wetness >= 0.55 ? 0.75 : 0.5;
  return boardTexture.wetness >= 0.55 ? bettingSizes.at(-2) : bettingSizes[1];
}

function equityBucketScore(bucket) {
  if (bucket === "equity-nut") return 1;
  if (bucket === "equity-high") return 0.78;
  if (bucket === "equity-medium") return 0.5;
  if (bucket === "equity-low") return 0.24;
  return 0.05;
}

function normalizeStage(stage) {
  const normalized = String(stage ?? "preflop").toLowerCase();
  return ["preflop", "flop", "turn", "river"].includes(normalized) ? normalized : "preflop";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampAmount(amount, availableChips) {
  return Math.max(0, Math.min(availableChips, Math.round(amount)));
}

function roundTo10(value) {
  return Math.round(value / 10) * 10;
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}
