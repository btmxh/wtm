import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYoutubeUrl } from "../src/youtube.ts";

test("parses channel and video URL shapes", () => {
  const cases: [string, ReturnType<typeof parseYoutubeUrl>][] = [
    ["https://www.youtube.com/@vtengoku", { kind: "handle", value: "vtengoku" }],
    ["youtube.com/@vtengoku/videos", { kind: "handle", value: "vtengoku" }],
    ["https://www.youtube.com/channel/UCabc123", { kind: "channel", value: "UCabc123" }],
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", { kind: "video", value: "dQw4w9WgXcQ" }],
    ["https://youtu.be/dQw4w9WgXcQ?si=x", { kind: "video", value: "dQw4w9WgXcQ" }],
    ["https://www.youtube.com/shorts/abcDEF12345", { kind: "video", value: "abcDEF12345" }],
    ["  https://m.youtube.com/@foo  ", { kind: "handle", value: "foo" }],
  ];
  for (const [input, expected] of cases) assert.deepEqual(parseYoutubeUrl(input), expected, input);
});

test("rejects URLs it cannot identify", () => {
  assert.throws(() => parseYoutubeUrl("https://www.youtube.com/"), /Could not parse/);
  assert.throws(() => parseYoutubeUrl("https://www.youtube.com/watch"), /Could not parse/);
  assert.throws(() => parseYoutubeUrl("http://[bad"), /Not a valid URL/);
});
