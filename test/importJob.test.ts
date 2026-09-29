import { test } from "node:test";
import assert from "node:assert/strict";
import { matchingOshis } from "../src/importJob.ts";
import type { OshiRow } from "../src/db.ts";

const oshis: OshiRow[] = [
  { id: 1, name: "Pekora", aliases: ["pekora", "ぺこら"] },
  { id: 2, name: "Marine", aliases: ["Marine", "#宝鐘マリン"] },
];
const names = (rows: OshiRow[]) => rows.map((o) => o.name);

test("matches aliases case-insensitively in the title", () => {
  assert.deepEqual(names(matchingOshis("x", "PEKORA and marine collab", "", oshis, "title")), ["Pekora", "Marine"]);
  assert.deepEqual(names(matchingOshis("x", "兎田ぺこら moment", "", oshis, "title")), ["Pekora"]);
});

test("title scope ignores the description", () => {
  assert.deepEqual(names(matchingOshis("x", "funny moment", "#宝鐘マリン", oshis, "title")), []);
  assert.deepEqual(names(matchingOshis("x", "funny moment", "#宝鐘マリン", oshis, "title+description")), ["Marine"]);
});

test("per-clipper cleaner drops the related videos footer", () => {
  const description = "clip of pekora\n\n★ Related Videos ★\nMarine best moments";
  assert.deepEqual(names(matchingOshis("vtengoku", "clip", description, oshis, "title+description")), ["Pekora"]);
  // Other clippers keep their full description.
  assert.deepEqual(names(matchingOshis("other", "clip", description, oshis, "title+description")), [
    "Pekora",
    "Marine",
  ]);
});
