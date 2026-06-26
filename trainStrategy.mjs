import { writeFile } from "node:fs/promises";
import {
  serializeStrategyTable,
  trainMCCFRStrategy,
} from "./solverLikeStrategy.js";

const DEFAULT_ITERATIONS = 160;
const DEFAULT_OUT_FILE = "strategy.json";

const options = parseArgs(process.argv.slice(2));
const iterations = Number(options.iterations ?? DEFAULT_ITERATIONS);
const outFile = String(options.out ?? DEFAULT_OUT_FILE);

if (!Number.isInteger(iterations) || iterations <= 0) {
  throw new Error("--iterations must be a positive integer");
}

const startedAt = Date.now();
const table = trainMCCFRStrategy({ iterations });
const payload = serializeStrategyTable(table, {
  iterations,
  generatedAt: new Date().toISOString(),
});

await writeFile(outFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

const elapsedMs = Date.now() - startedAt;
console.log(`Wrote ${payload.informationSetCount} information sets to ${outFile}`);
console.log(`Iterations: ${iterations}`);
console.log(`Elapsed: ${elapsedMs}ms`);

function parseArgs(args) {
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--iterations") {
      parsed.iterations = args[index + 1];
      index += 1;
    } else if (arg.startsWith("--iterations=")) {
      parsed.iterations = arg.slice("--iterations=".length);
    } else if (arg === "--out") {
      parsed.out = args[index + 1];
      index += 1;
    } else if (arg.startsWith("--out=")) {
      parsed.out = arg.slice("--out=".length);
    }
  }

  return parsed;
}
