import assert from "node:assert/strict";
import test from "node:test";
import { addDays, evaluateWalkForward } from "../scripts/health-factor-model.mjs";

test("walk-forward evaluation identifies a stable positive personal predictor", () => {
  const pairs = Array.from({ length: 40 }, (_, index) => ({
    date: addDays("2026-01-01", index),
    x: index + 1,
    y: 0.15 * (index + 1) - 3,
  }));

  const result = evaluateWalkForward(pairs);
  assert.ok(result);
  assert.ok(result.correlation > 0.999);
  assert.ok(result.predictiveGain > 0.999);
  assert.equal(result.stability, 1);
  assert.equal(result.evaluatedDays, 24);
});

test("walk-forward evaluation preserves a negative direction", () => {
  const pairs = Array.from({ length: 40 }, (_, index) => ({
    date: addDays("2026-01-01", index),
    x: index + 1,
    y: 3 - 0.1 * (index + 1),
  }));

  const result = evaluateWalkForward(pairs);
  assert.ok(result);
  assert.ok(result.correlation < -0.999);
  assert.equal(result.stability, 1);
});

test("walk-forward evaluation withholds uninformative constant series", () => {
  const pairs = Array.from({ length: 40 }, (_, index) => ({
    date: addDays("2026-01-01", index),
    x: 1,
    y: index % 2,
  }));
  assert.equal(evaluateWalkForward(pairs), null);
});
