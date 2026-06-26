import assert from "node:assert/strict";
import { appendLogMessage } from "../uiMessages.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("message log keeps visible messages in chronological order", () => {
  const messages = ["player bet 201", "AI raised to 511"];
  const updated = appendLogMessage(messages, "player called all-in", 8);

  assert.deepEqual(updated, [
    "player bet 201",
    "AI raised to 511",
    "player called all-in",
  ]);
});

test("message log trims old entries while preserving oldest-to-newest display order", () => {
  const messages = ["1", "2", "3", "4", "5", "6", "7", "8"];
  const updated = appendLogMessage(messages, "9", 8);

  assert.deepEqual(updated, ["2", "3", "4", "5", "6", "7", "8", "9"]);
});
