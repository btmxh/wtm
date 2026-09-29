import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEFAULT_DB_PATH = fileURLToPath(new URL("../data/wtm.sqlite", import.meta.url));
const SCHEMA_PATH = fileURLToPath(new URL("./schema.sql", import.meta.url));

// SQLite's CREATE TABLE IF NOT EXISTS won't retrofit new columns onto an
// existing table, so columns added after the first release need a manual
// ALTER TABLE here, guarded by a PRAGMA table_info check. Runs before
// schema.sql so that file's CREATE INDEX statements can assume the column
// already exists.
function migrate(db: DatabaseSync): void {
  const clipsTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'clips'").get();
  if (!clipsTable) return; // fresh db - schema.sql below creates it with every column

  const columns = db.prepare("PRAGMA table_info(clips)").all() as { name: string }[];
  if (!columns.some((c) => c.name === "kind_verified")) {
    db.exec("ALTER TABLE clips ADD COLUMN kind_verified INTEGER NOT NULL DEFAULT 0");
  }

  // groups/oshi_groups were scaffolded, then dropped in favor of tags - drop
  // them here for dbs created before that decision.
  db.exec("DROP TABLE IF EXISTS oshi_groups");
  db.exec("DROP TABLE IF EXISTS groups");

  const tagsTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tags'").get();
  if (tagsTable) {
    const tagColumns = db.prepare("PRAGMA table_info(tags)").all() as { name: string }[];
    if (!tagColumns.some((c) => c.name === "prompt")) {
      db.exec("ALTER TABLE tags ADD COLUMN prompt TEXT");
    }
  }
}

export function openDb(path = DEFAULT_DB_PATH): DatabaseSync {
  mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
  const db = new DatabaseSync(path);
  migrate(db);
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  return db;
}

export interface OshiRow {
  id: number;
  name: string;
  aliases: string[];
}

export function upsertOshi(db: DatabaseSync, name: string, aliases: string[]): number {
  const row = db
    .prepare(
      `INSERT INTO oshis (name, aliases) VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET aliases = excluded.aliases
       RETURNING id`,
    )
    .get(name, JSON.stringify(aliases)) as { id: number };
  return row.id;
}

export function listOshisByIds(db: DatabaseSync, ids: number[]): OshiRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map((_, i) => `:id${i}`).join(",");
  const params: Record<string, SQLInputValue> = {};
  for (const [i, id] of ids.entries()) params[`id${i}`] = id;
  const rows = db
    .prepare(`SELECT id, name, aliases FROM oshis WHERE id IN (${placeholders})`)
    .all(params) as unknown as { id: number; name: string; aliases: string }[];
  return rows.map((r) => ({ id: r.id, name: r.name, aliases: JSON.parse(r.aliases) }));
}

export function listOshis(db: DatabaseSync): OshiRow[] {
  const rows = db.prepare("SELECT id, name, aliases FROM oshis").all() as {
    id: number;
    name: string;
    aliases: string;
  }[];
  return rows.map((r) => ({ id: r.id, name: r.name, aliases: JSON.parse(r.aliases) }));
}

export interface ClipperRow {
  id: number;
  handle: string;
  channelId: string;
  title: string;
  uploadsPlaylistId: string;
}

export function upsertClipper(
  db: DatabaseSync,
  clipper: { handle: string; channelId: string; title: string; uploadsPlaylistId: string },
): number {
  const row = db
    .prepare(
      `INSERT INTO clippers (handle, channel_id, title, uploads_playlist_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(handle) DO UPDATE SET
         channel_id = excluded.channel_id,
         title = excluded.title,
         uploads_playlist_id = excluded.uploads_playlist_id
       RETURNING id`,
    )
    .get(clipper.handle, clipper.channelId, clipper.title, clipper.uploadsPlaylistId) as {
    id: number;
  };
  return row.id;
}

export interface ClipInput {
  videoId: string;
  clipperId: number;
  title: string;
  description: string;
  url: string;
  publishedAt: string;
  durationSeconds: number;
  kind: "short" | "video";
}

export function upsertClip(db: DatabaseSync, clip: ClipInput): number {
  const row = db
    .prepare(
      `INSERT INTO clips
         (video_id, clipper_id, title, description, url, published_at, duration_seconds, kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(video_id) DO UPDATE SET
         title = excluded.title,
         description = excluded.description,
         duration_seconds = excluded.duration_seconds,
         kind = CASE WHEN kind_verified = 0 THEN excluded.kind ELSE kind END
       RETURNING id`,
    )
    .get(
      clip.videoId,
      clip.clipperId,
      clip.title,
      clip.description,
      clip.url,
      clip.publishedAt,
      clip.durationSeconds,
      clip.kind,
    ) as { id: number };
  return row.id;
}

export function getClipperById(db: DatabaseSync, id: number): ClipperRow | undefined {
  return db
    .prepare(
      `SELECT id, handle, channel_id AS channelId, title, uploads_playlist_id AS uploadsPlaylistId
       FROM clippers WHERE id = ?`,
    )
    .get(id) as ClipperRow | undefined;
}

export function countClipsByKind(db: DatabaseSync, clipperId: number): { short: number; video: number } {
  const rows = db
    .prepare("SELECT kind, COUNT(*) AS n FROM clips WHERE clipper_id = ? GROUP BY kind")
    .all(clipperId) as unknown as { kind: "short" | "video"; n: number }[];
  const counts = { short: 0, video: 0 };
  for (const r of rows) counts[r.kind] = r.n;
  return counts;
}

export interface UnverifiedClip {
  id: number;
  videoId: string;
  kind: "short" | "video";
}

export function listUnverifiedClips(db: DatabaseSync): UnverifiedClip[] {
  return db
    .prepare("SELECT id, video_id AS videoId, kind FROM clips WHERE kind_verified = 0")
    .all() as unknown as UnverifiedClip[];
}

export function setVerifiedKind(db: DatabaseSync, clipId: number, kind: "short" | "video"): void {
  db.prepare("UPDATE clips SET kind = ?, kind_verified = 1 WHERE id = ?").run(kind, clipId);
}

// Re-derives heuristic oshi links for a clip without touching any
// manual/LLM-sourced links a person may have already corrected.
export function setHeuristicClipOshis(db: DatabaseSync, clipId: number, oshiIds: number[]): void {
  db.prepare("DELETE FROM clip_oshis WHERE clip_id = ? AND source = 'heuristic'").run(clipId);
  const insert = db.prepare("INSERT OR IGNORE INTO clip_oshis (clip_id, oshi_id, source) VALUES (?, ?, 'heuristic')");
  for (const oshiId of oshiIds) insert.run(clipId, oshiId);
}

export interface ClipForTagging {
  id: number;
  title: string;
  description: string;
}

export function listClipsForTagging(db: DatabaseSync): ClipForTagging[] {
  return db.prepare("SELECT id, title, description FROM clips").all() as unknown as ClipForTagging[];
}

export interface TagForTagging {
  id: number;
  name: string;
  prompt: string;
}

// Only tags with a prompt can be auto-tagged against - there's no criterion
// to judge otherwise.
export function listTaggableTags(db: DatabaseSync): TagForTagging[] {
  return db
    .prepare("SELECT id, name, prompt FROM tags WHERE prompt IS NOT NULL AND trim(prompt) != ''")
    .all() as unknown as TagForTagging[];
}

export function listAttachedTagIds(db: DatabaseSync, clipId: number): Set<number> {
  const rows = db.prepare("SELECT tag_id FROM clip_tags WHERE clip_id = ?").all(clipId) as {
    tag_id: number;
  }[];
  return new Set(rows.map((r) => r.tag_id));
}

// Records an LLM judgment as a clip_tags row - only called for tags not
// already linked to the clip by any source, so no conflict handling needed.
export function setLlmClipTag(db: DatabaseSync, clipId: number, tagId: number, confidence: number): void {
  db.prepare("INSERT OR IGNORE INTO clip_tags (clip_id, tag_id, source, confidence) VALUES (?, ?, 'llm', ?)").run(
    clipId,
    tagId,
    confidence,
  );
}
