import {
  upsertClipper,
  upsertClip,
  setHeuristicClipOshis,
  countClipsByKind,
  getClipperById,
  listOshisByIds,
  type OshiRow,
} from "./db.ts";
import {
  parseYoutubeUrl,
  resolveChannel,
  resolveChannelById,
  resolveChannelForVideo,
  fetchPlaylistItems,
  fetchDurations,
} from "./youtube.ts";
import type { DatabaseSync } from "node:sqlite";
import type { JobReport } from "./jobs.ts";

// YouTube's public API doesn't expose an explicit "is this a Short" flag.
// Duration <= 60s is the standard heuristic; it'll misclassify the small
// number of post-2024 long-form Shorts (up to 3min), good enough for now.
const SHORT_MAX_SECONDS = 60;

export type MatchScope = "title" | "title+description";

export function matchingOshis(
  title: string,
  description: string,
  oshis: OshiRow[],
  scope: MatchScope,
): OshiRow[] {
  const haystack = (scope === "title" ? title : `${title}\n${description}`).toLowerCase();
  return oshis.filter((o) => o.aliases.some((a) => haystack.includes(a.toLowerCase())));
}

export interface ResolvedClipper {
  clipperId: number;
  handle: string;
  title: string;
  uploadsPlaylistId: string;
}

// Resolves a pasted channel or video URL to a channel, upserting it as a
// clipper - this is the "discover clipper" step of the import UI.
export async function resolveClipperFromUrl(db: DatabaseSync, url: string): Promise<ResolvedClipper> {
  const parsed = parseYoutubeUrl(url);

  const channel =
    parsed.kind === "handle"
      ? await resolveChannel(parsed.value)
      : parsed.kind === "channel"
        ? await resolveChannelById(parsed.value)
        : await resolveChannelForVideo(parsed.value);

  // Channels that never set a handle don't have one to key on - the
  // channelId is unique and stable, so it's a safe fallback for the
  // clippers.handle column.
  const handle = channel.handle ?? channel.channelId;

  const clipperId = upsertClipper(db, {
    handle,
    channelId: channel.channelId,
    title: channel.title,
    uploadsPlaylistId: channel.uploadsPlaylistId,
  });

  return { clipperId, handle, title: channel.title, uploadsPlaylistId: channel.uploadsPlaylistId };
}

export interface ImportOptions {
  clipperId: number;
  // Which oshis to check aliases for while heuristically tagging - every
  // video/short from the channel is imported regardless of this list.
  oshiIds: number[];
  matchScope: MatchScope;
}

export async function runImport(db: DatabaseSync, opts: ImportOptions, onProgress: JobReport): Promise<void> {
  const clipper = getClipperById(db, opts.clipperId);
  if (!clipper) throw new Error(`clipper ${opts.clipperId} not found`);

  const scopedOshis = listOshisByIds(db, opts.oshiIds);

  onProgress({ message: `fetching uploads for @${clipper.handle}...` });
  const videos = [];
  for await (const v of fetchPlaylistItems(clipper.uploadsPlaylistId)) videos.push(v);
  onProgress({ total: videos.length, message: `@${clipper.handle}: ${videos.length} uploads` });

  const durations = await fetchDurations(videos.map((v) => v.videoId));

  let oshiHits = 0;
  let checked = 0;

  for (const v of videos) {
    const durationSeconds = durations.get(v.videoId) ?? 0;
    const kind = durationSeconds <= SHORT_MAX_SECONDS ? "short" : "video";

    const clipId = upsertClip(db, {
      videoId: v.videoId,
      clipperId: opts.clipperId,
      title: v.title,
      description: v.description,
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      publishedAt: v.publishedAt,
      durationSeconds,
      kind,
    });

    const matched = matchingOshis(v.title, v.description, scopedOshis, opts.matchScope);
    if (matched.length > 0) oshiHits++;
    setHeuristicClipOshis(
      db,
      clipId,
      matched.map((o) => o.id),
    );

    checked++;
    onProgress({ current: checked });
  }

  const kindCounts = countClipsByKind(db, opts.clipperId);
  onProgress({
    message: `@${clipper.handle}: ${oshiHits}/${videos.length} oshi, ${kindCounts.short}/${videos.length} shorts`,
  });
}
