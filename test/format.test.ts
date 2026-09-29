import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration } from "../src/format.ts";
import { oshiHue } from "../src/oshiColor.ts";

test("formatDuration pads seconds, and minutes only when there are hours", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(59), "0:59");
  assert.equal(formatDuration(61), "1:01");
  assert.equal(formatDuration(3600), "1:00:00");
  assert.equal(formatDuration(3725), "1:02:05");
});

test("oshiHue is deterministic and in range", () => {
  for (const name of ["", "Pekora", "星街すいせい", "a".repeat(500)]) {
    const hue = oshiHue(name);
    assert.equal(hue, oshiHue(name));
    assert.ok(hue >= 0 && hue < 360);
  }
});
