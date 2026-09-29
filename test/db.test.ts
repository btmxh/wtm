import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openDb,
  upsertOshi,
  upsertClipper,
  upsertClip,
  setVerifiedKind,
  setHeuristicClipOshis,
  listUnverifiedClips,
  type ClipInput,
} from "../src/db.ts";
import { listClips, markWatched, attachTagToClip, createTag, getClip } from "../src/queries.ts";

function seed() {
  const db = openDb(":memory:");
  const clipperId = upsertClipper(db, {
    handle: "clipper",
    channelId: "UC1",
    title: "Clipper",
    uploadsPlaylistId: "UU1",
  });
  const clip = (videoId: string, overrides: Partial<ClipInput> = {}): ClipInput => ({
    videoId,
    clipperId,
    title: `title ${videoId}`,
    description: "",
    url: `https://youtu.be/${videoId}`,
    publishedAt: "2026-01-01T00:00:00Z",
    durationSeconds: 30,
    kind: "short",
    ...overrides,
  });
  return { db, clipperId, clip };
}

test("upsertClip only changes kind while it is unverified", () => {
  const { db, clip } = seed();
  const id = upsertClip(db, clip("a"));
  assert.equal(upsertClip(db, clip("a", { kind: "video" })), id);
  assert.equal(getClip(db, id)?.kind, "video");

  setVerifiedKind(db, id, "short");
  upsertClip(db, clip("a", { kind: "video", title: "renamed" }));
  const row = getClip(db, id);
  assert.equal(row?.kind, "short");
  assert.equal(row?.title, "renamed");
  assert.deepEqual(listUnverifiedClips(db), []);
});

test("setHeuristicClipOshis keeps manual and llm links", () => {
  const { db, clip } = seed();
  const clipId = upsertClip(db, clip("a"));
  const [a, b, c, d] = ["A", "B", "C", "D"].map((n) => upsertOshi(db, n, [n.toLowerCase()]));
  db.prepare("INSERT INTO clip_oshis (clip_id, oshi_id, source) VALUES (?, ?, 'manual')").run(clipId, a);
  db.prepare("INSERT INTO clip_oshis (clip_id, oshi_id, source) VALUES (?, ?, 'llm')").run(clipId, b);

  setHeuristicClipOshis(db, clipId, [a, c]);
  setHeuristicClipOshis(db, clipId, [a, d]);

  const rows = db
    .prepare("SELECT oshi_id AS oshiId, source FROM clip_oshis WHERE clip_id = ? ORDER BY oshi_id")
    .all(clipId);
  assert.deepEqual(
    rows.map((r) => ({ ...r })),
    [
      { oshiId: a, source: "manual" },
      { oshiId: b, source: "llm" },
      { oshiId: d, source: "heuristic" },
    ],
  );
});

test("listClips applies filters", () => {
  const { db, clip } = seed();
  const short = upsertClip(db, clip("s", { publishedAt: "2026-01-02T00:00:00Z" }));
  const video = upsertClip(db, clip("v", { kind: "video", durationSeconds: 600 }));
  const oshi = upsertOshi(db, "O", ["o"]);
  setHeuristicClipOshis(db, video, [oshi]);
  createTag(db, "funny", null);
  const tagId = (db.prepare("SELECT id FROM tags WHERE name = 'funny'").get() as { id: number }).id;
  attachTagToClip(db, short, tagId);
  markWatched(db, video, "good");

  const ids = (filters: Parameters<typeof listClips>[1]) => listClips(db, filters).map((c) => c.id);
  assert.deepEqual(ids({}), [short, video]);
  assert.deepEqual(ids({ kind: "video" }), [video]);
  assert.deepEqual(ids({ oshiId: oshi }), [video]);
  assert.deepEqual(ids({ tagId }), [short]);
  assert.deepEqual(ids({ watched: "watched" }), [video]);
  assert.deepEqual(ids({ watched: "unwatched" }), [short]);
  assert.equal(listClips(db, {}).find((c) => c.id === video)?.watched, true);
});

test("openDb migrates a pre-kind_verified database", () => {
  const dir = mkdtempSync(join(tmpdir(), "wtm-test-"));
  try {
    const path = join(dir, "old.sqlite");
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE clips (id INTEGER PRIMARY KEY, video_id TEXT NOT NULL UNIQUE, clipper_id INTEGER NOT NULL,
        title TEXT NOT NULL, description TEXT NOT NULL, url TEXT NOT NULL, published_at TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL, kind TEXT NOT NULL, fetched_at TEXT);
      CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
      CREATE TABLE groups (id INTEGER PRIMARY KEY);
      CREATE TABLE oshi_groups (group_id INTEGER);
    `);
    old.close();

    const db = openDb(path);
    const columns = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    assert.ok(columns("clips").includes("kind_verified"));
    assert.ok(columns("tags").includes("prompt"));
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    assert.ok(!tables.some((t) => t.name === "groups" || t.name === "oshi_groups"));
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
