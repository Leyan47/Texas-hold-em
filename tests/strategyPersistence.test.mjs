import assert from "node:assert/strict";
import {
  getSolverStrategyTable,
  hydrateStrategyTable,
  loadStrategyFile,
  serializeStrategyTable,
  setSolverStrategyTable,
  trainMCCFRStrategy,
} from "../solverLikeStrategy.js";

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result
        .then(() => console.log(`PASS ${name}`))
        .catch((error) => {
          console.error(`FAIL ${name}`);
          throw error;
        });
    }

    console.log(`PASS ${name}`);
    return undefined;
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

await test("strategy table serializes and hydrates without losing frequencies", () => {
  const trained = trainMCCFRStrategy({ iterations: 2 });
  const payload = serializeStrategyTable(trained, {
    iterations: 2,
    generatedAt: "2026-06-26T00:00:00.000Z",
  });
  const hydrated = hydrateStrategyTable(payload);
  const key = "preflop|root|none|medium|neutral|equity-medium|dry";

  assert.equal(payload.version, 1);
  assert.equal(payload.iterations, 2);
  assert.equal(payload.informationSetCount, trained.size);
  assert.deepEqual(hydrated.get(key), trained.get(key));
});

await test("loadStrategyFile installs an externally loaded strategy table", async () => {
  const originalFetch = globalThis.fetch;
  const trained = trainMCCFRStrategy({ iterations: 2 });
  const payload = serializeStrategyTable(trained, {
    iterations: 2,
    generatedAt: "2026-06-26T00:00:00.000Z",
  });

  globalThis.fetch = async (url) => {
    assert.equal(url, "strategy.json");
    return {
      ok: true,
      json: async () => payload,
    };
  };

  try {
    const loaded = await loadStrategyFile("strategy.json");
    const current = getSolverStrategyTable();

    assert.equal(loaded, true);
    assert.deepEqual(current.get("river|root|none|large|tight|equity-nut|wet"), payload.strategy["river|root|none|large|tight|equity-nut|wet"]);
  } finally {
    setSolverStrategyTable(null);
    globalThis.fetch = originalFetch;
  }
});
