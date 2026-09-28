import type { DatabaseSync } from "node:sqlite";

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
  const params: Record<string, unknown> = {};

  if (filters.oshiId != null) {
    where.push(
      "c.id IN (SELECT clip_id FROM clip_oshis WHERE oshi_id = :oshiId)",
    );
    params.oshiId = filters.oshiId;
  }
  if (filters.clipperId != null) {
    where.push("c.clipper_id = :clipperId");
    params.clipperId = filters.clipperId;
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

  const rows = db.prepare(sql).all(params) as unknown as (ClipListItem & { watched: number })[];
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
  const params: Record<string, unknown> = {};
  clipIds.forEach((id, i) => (params[`id${i}`] = id));

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
    .get({ id }) as unknown as Omit<ClipDetail, "oshis"> | undefined;

  if (!row) return undefined;

  const oshis = oshisForClips(db, [id]).get(id) ?? [];
  return { ...row, oshis };
}

export function markWatched(db: DatabaseSync, clipId: number, takeaway: string): void {
  db.prepare(
    `INSERT INTO watches (clip_id, takeaway) VALUES (?, ?)
     ON CONFLICT(clip_id) DO UPDATE SET takeaway = excluded.takeaway`,
  ).run(clipId, takeaway);
}
