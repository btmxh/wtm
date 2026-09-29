import type { DatabaseSync, SQLInputValue } from "node:sqlite";

export interface OshiSummary {
  id: number;
  name: string;
  clipCount: number;
  watchedCount: number;
}

export function listOshiSummaries(db: DatabaseSync): OshiSummary[] {
  return db
    .prepare(
      `SELECT
         o.id,
         o.name,
         COUNT(DISTINCT co.clip_id) AS clipCount,
         COUNT(DISTINCT w.clip_id) AS watchedCount
       FROM oshis o
       LEFT JOIN clip_oshis co ON co.oshi_id = o.id
       LEFT JOIN watches w ON w.clip_id = co.clip_id
       GROUP BY o.id
       ORDER BY o.name`,
    )
    .all() as unknown as OshiSummary[];
}

export interface ClipperSummary {
  id: number;
  handle: string;
  clipCount: number;
}

export function listClipperSummaries(db: DatabaseSync): ClipperSummary[] {
  return db
    .prepare(
      `SELECT c.id, c.handle, COUNT(cl.id) AS clipCount
       FROM clippers c
       LEFT JOIN clips cl ON cl.clipper_id = c.id
       GROUP BY c.id
       ORDER BY c.handle`,
    )
    .all() as unknown as ClipperSummary[];
}

export interface ClipFilters {
  oshiId?: number;
  clipperId?: number;
  tagId?: number;
  kind?: "short" | "video";
  watched?: "watched" | "unwatched";
}

export interface ClipListItem {
  id: number;
  videoId: string;
  title: string;
  publishedAt: string;
  durationSeconds: number;
  kind: "short" | "video";
  clipperHandle: string;
  watched: boolean;
}

export function listClips(db: DatabaseSync, filters: ClipFilters): ClipListItem[] {
  const where: string[] = [];
  const params: Record<string, SQLInputValue> = {};

  if (filters.oshiId != null) {
    where.push("c.id IN (SELECT clip_id FROM clip_oshis WHERE oshi_id = :oshiId)");
    params.oshiId = filters.oshiId;
  }
  if (filters.clipperId != null) {
    where.push("c.clipper_id = :clipperId");
    params.clipperId = filters.clipperId;
  }
  if (filters.tagId != null) {
    where.push("c.id IN (SELECT clip_id FROM clip_tags WHERE tag_id = :tagId)");
    params.tagId = filters.tagId;
  }
  if (filters.kind) {
    where.push("c.kind = :kind");
    params.kind = filters.kind;
  }
  if (filters.watched === "watched") {
    where.push("w.clip_id IS NOT NULL");
  } else if (filters.watched === "unwatched") {
    where.push("w.clip_id IS NULL");
  }

  const sql = `
    SELECT
      c.id, c.video_id AS videoId, c.title, c.published_at AS publishedAt,
      c.duration_seconds AS durationSeconds, c.kind,
      cp.handle AS clipperHandle,
      (w.clip_id IS NOT NULL) AS watched
    FROM clips c
    JOIN clippers cp ON cp.id = c.clipper_id
    LEFT JOIN watches w ON w.clip_id = c.id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY c.published_at DESC
  `;

  const rows = db.prepare(sql).all(params) as unknown as (Omit<ClipListItem, "watched"> & { watched: number })[];
  return rows.map((r) => ({ ...r, watched: !!r.watched }));
}

export interface ClipOshiLink {
  id: number;
  name: string;
}

export function oshisForClips(db: DatabaseSync, clipIds: number[]): Map<number, ClipOshiLink[]> {
  const map = new Map<number, ClipOshiLink[]>();
  if (clipIds.length === 0) return map;

  const placeholders = clipIds.map((_, i) => `:id${i}`).join(",");
  const params: Record<string, SQLInputValue> = {};
  for (const [i, id] of clipIds.entries()) params[`id${i}`] = id;

  const rows = db
    .prepare(
      `SELECT co.clip_id AS clipId, o.id, o.name
       FROM clip_oshis co
       JOIN oshis o ON o.id = co.oshi_id
       WHERE co.clip_id IN (${placeholders})
       ORDER BY o.name`,
    )
    .all(params) as unknown as { clipId: number; id: number; name: string }[];

  for (const r of rows) {
    const list = map.get(r.clipId) ?? [];
    list.push({ id: r.id, name: r.name });
    map.set(r.clipId, list);
  }
  return map;
}

export interface Tag {
  id: number;
  name: string;
}

export interface TagSummary extends Tag {
  prompt: string | null;
  clipCount: number;
}

export function listTags(db: DatabaseSync): TagSummary[] {
  return db
    .prepare(
      `SELECT t.id, t.name, t.prompt, COUNT(ct.clip_id) AS clipCount
       FROM tags t
       LEFT JOIN clip_tags ct ON ct.tag_id = t.id
       GROUP BY t.id
       ORDER BY t.name`,
    )
    .all() as unknown as TagSummary[];
}

// Tags are a pre-made vocabulary managed via the /tags page, not created ad
// hoc while tagging a clip - hence plain create/update/delete, no upsert.
export function createTag(db: DatabaseSync, name: string, prompt: string | null): void {
  db.prepare("INSERT OR IGNORE INTO tags (name, prompt) VALUES (?, ?)").run(name, prompt);
}

export function updateTag(db: DatabaseSync, id: number, name: string, prompt: string | null): void {
  db.prepare("UPDATE tags SET name = ?, prompt = ? WHERE id = ?").run(name, prompt, id);
}

export function deleteTag(db: DatabaseSync, id: number): void {
  db.prepare("DELETE FROM tags WHERE id = ?").run(id);
}

export function tagsForClips(db: DatabaseSync, clipIds: number[]): Map<number, Tag[]> {
  const map = new Map<number, Tag[]>();
  if (clipIds.length === 0) return map;

  const placeholders = clipIds.map((_, i) => `:id${i}`).join(",");
  const params: Record<string, SQLInputValue> = {};
  for (const [i, id] of clipIds.entries()) params[`id${i}`] = id;

  const rows = db
    .prepare(
      `SELECT ct.clip_id AS clipId, t.id, t.name
       FROM clip_tags ct
       JOIN tags t ON t.id = ct.tag_id
       WHERE ct.clip_id IN (${placeholders})
       ORDER BY t.name`,
    )
    .all(params) as unknown as { clipId: number; id: number; name: string }[];

  for (const r of rows) {
    const list = map.get(r.clipId) ?? [];
    list.push({ id: r.id, name: r.name });
    map.set(r.clipId, list);
  }
  return map;
}

// Links an already-existing tag to a clip; the tag itself is managed
// separately via the /tags page, not created ad hoc here.
export function attachTagToClip(db: DatabaseSync, clipId: number, tagId: number): void {
  db.prepare("INSERT OR IGNORE INTO clip_tags (clip_id, tag_id, source) VALUES (?, ?, 'manual')").run(clipId, tagId);
}

export function removeTagFromClip(db: DatabaseSync, clipId: number, tagId: number): void {
  db.prepare("DELETE FROM clip_tags WHERE clip_id = ? AND tag_id = ?").run(clipId, tagId);
}

export interface ClipDetail {
  id: number;
  videoId: string;
  title: string;
  description: string;
  url: string;
  publishedAt: string;
  durationSeconds: number;
  kind: "short" | "video";
  clipperHandle: string;
  oshis: ClipOshiLink[];
  tags: Tag[];
  watchedAt: string | null;
  takeaway: string | null;
}

export function getClip(db: DatabaseSync, id: number): ClipDetail | undefined {
  const row = db
    .prepare(
      `SELECT
         c.id, c.video_id AS videoId, c.title, c.description, c.url,
         c.published_at AS publishedAt, c.duration_seconds AS durationSeconds, c.kind,
         cp.handle AS clipperHandle,
         w.watched_at AS watchedAt, w.takeaway AS takeaway
       FROM clips c
       JOIN clippers cp ON cp.id = c.clipper_id
       LEFT JOIN watches w ON w.clip_id = c.id
       WHERE c.id = :id`,
    )
    .get({ id }) as unknown as Omit<ClipDetail, "oshis" | "tags"> | undefined;

  if (!row) return undefined;

  const oshis = oshisForClips(db, [id]).get(id) ?? [];
  const tags = tagsForClips(db, [id]).get(id) ?? [];
  return { ...row, oshis, tags };
}

export function markWatched(db: DatabaseSync, clipId: number, takeaway: string): void {
  db.prepare(
    `INSERT INTO watches (clip_id, takeaway) VALUES (?, ?)
     ON CONFLICT(clip_id) DO UPDATE SET takeaway = excluded.takeaway`,
  ).run(clipId, takeaway);
}

export interface OverallProgress {
  totalClips: number;
  watchedClips: number;
}

export function getOverallProgress(db: DatabaseSync): OverallProgress {
  return db
    .prepare(
      `SELECT
         COUNT(*) AS totalClips,
         COUNT(w.clip_id) AS watchedClips
       FROM clips c
       LEFT JOIN watches w ON w.clip_id = c.id`,
    )
    .get() as unknown as OverallProgress;
}

export interface TagProgress {
  id: number;
  name: string;
  clipCount: number;
  watchedCount: number;
}

export function getTagProgress(db: DatabaseSync): TagProgress[] {
  return db
    .prepare(
      `SELECT
         t.id, t.name,
         COUNT(DISTINCT ct.clip_id) AS clipCount,
         COUNT(DISTINCT w.clip_id) AS watchedCount
       FROM tags t
       LEFT JOIN clip_tags ct ON ct.tag_id = t.id
       LEFT JOIN watches w ON w.clip_id = ct.clip_id
       GROUP BY t.id
       ORDER BY t.name`,
    )
    .all() as unknown as TagProgress[];
}

// Per-tag clip/watched counts restricted to clips featuring one oshi - the
// stats page computes this for every oshi up front (dataset is tiny).
export function getOshiTagBreakdown(db: DatabaseSync, oshiId: number): TagProgress[] {
  return db
    .prepare(
      `SELECT
         t.id, t.name,
         COUNT(DISTINCT ct.clip_id) AS clipCount,
         COUNT(DISTINCT w.clip_id) AS watchedCount
       FROM tags t
       LEFT JOIN clip_tags ct
         ON ct.tag_id = t.id
         AND ct.clip_id IN (SELECT clip_id FROM clip_oshis WHERE oshi_id = :oshiId)
       LEFT JOIN watches w ON w.clip_id = ct.clip_id
       GROUP BY t.id
       ORDER BY t.name`,
    )
    .all({ oshiId }) as unknown as TagProgress[];
}

export interface HeatmapDay {
  day: string;
  count: number;
}

export function getWatchHeatmap(db: DatabaseSync, sinceIso: string): HeatmapDay[] {
  return db
    .prepare(
      `SELECT date(watched_at) AS day, COUNT(*) AS count
       FROM watches
       WHERE watched_at >= :sinceIso
       GROUP BY day
       ORDER BY day`,
    )
    .all({ sinceIso }) as unknown as HeatmapDay[];
}
