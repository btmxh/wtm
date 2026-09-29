import { test } from "node:test";
import assert from "node:assert/strict";
import { seededShuffle } from "../src/shuffle.ts";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

test("same seed gives the same order", () => {
  assert.deepEqual(seededShuffle(range(50), 1234), seededShuffle(range(50), 1234));
});

test("different seeds give different orders", () => {
  assert.notDeepEqual(seededShuffle(range(50), 1), seededShuffle(range(50), 2));
});

test("result is a permutation of the input, shuffled in place", () => {
  const items = range(100);
  const out = seededShuffle(items, 42);
  assert.equal(out, items);
  assert.deepEqual(
    [...out].sort((a, b) => a - b),
    range(100),
  );
});
