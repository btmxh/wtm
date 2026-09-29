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

// A cleaner is arbitrary logic over a raw description, not just "cut after
// a marker" - some clipper's quirk might be a credits block at the top, an
// interleaved timestamp list, whatever. Keeping it a plain function is what
// lets each clipper's cleanup be logically whatever it needs to be, instead
// of everything having to fit one shape (like "list of regexes to cut at").
type DescriptionCleaner = (description: string) => string;

// Keyed by clippers.handle, since a section that's boilerplate on one
// channel could be a real, matchable mention on another - applying a
// cleaner globally risks silently eating real content. This is a
// single-user tool, so a plain in-source table someone edits directly as
// new clippers' quirks turn up is the whole workflow: no DB column or admin
// UI needed for something only the one developer ever touches.
const CLIPPER_DESCRIPTION_CLEANERS: Record<string, DescriptionCleaner[]> = {
  vtengoku: [cutBeforeRelatedVideosFooter],
};

// "★ Related Videos ★" (seen with/without spacing, half/full-width stars)
// links to OTHER, unrelated videos - their titles would otherwise get swept
// into the match.
function cutBeforeRelatedVideosFooter(description: string): string {
  const idx = description.search(/related\s+videos/i);
  return idx === -1 ? description : description.slice(0, idx);
}

function cleanDescription(clipperHandle: string, description: string): string {
  const cleaners = CLIPPER_DESCRIPTION_CLEANERS[clipperHandle] ?? [];
  return cleaners.reduce((desc, clean) => clean(desc), description);
}

export function matchingOshis(
  clipperHandle: string,
  title: string,
  description: string,
  oshis: OshiRow[],
  scope: MatchScope,
): OshiRow[] {
  const cleanedDescription = cleanDescription(clipperHandle, description);
  const haystack = (scope === "title" ? title : `${title}\n${cleanedDescription}`).toLowerCase();
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

export async function runImport(
  db: DatabaseSync,
  opts: ImportOptions,
  onProgress: JobReport,
  signal: AbortSignal,
): Promise<void> {
  const clipper = getClipperById(db, opts.clipperId);
  if (!clipper) throw new Error(`clipper ${opts.clipperId} not found`);

  const scopedOshis = listOshisByIds(db, opts.oshiIds);
  const onQuota = (units: number) => onProgress({ metaDelta: { youtubeQuotaUnits: units } });

  onProgress({ message: `fetching uploads for @${clipper.handle}...` });
  const videos = [];
  for await (const v of fetchPlaylistItems(clipper.uploadsPlaylistId, onQuota, signal)) videos.push(v);
  onProgress({ total: videos.length, message: `@${clipper.handle}: ${videos.length} uploads` });

  onProgress({ message: `fetching durations for ${videos.length} video(s)...` });
  const durations = await fetchDurations(
    videos.map((v) => v.videoId),
    onQuota,
    (completed, totalChunks) => {
      onProgress({ current: Math.min(completed * 50, videos.length) });
      if (completed === totalChunks || completed % 10 === 0) {
        onProgress({ message: `fetched durations: ${completed}/${totalChunks} batch(es)` });
      }
    },
    signal,
  );

  let oshiHits = 0;
  let checked = 0;

  for (const v of videos) {
    if (signal.aborted) break;

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

    const matched = matchingOshis(clipper.handle, v.title, v.description, scopedOshis, opts.matchScope);
    if (matched.length > 0) oshiHits++;
    setHeuristicClipOshis(
      db,
      clipId,
      matched.map((o) => o.id),
    );

    checked++;
    onProgress({ current: checked });

    // node:sqlite is synchronous, so this loop otherwise runs to completion
    // in one JS turn - on a big channel that starves the event loop for the
    // whole import, both freezing every other request the server is
    // handling and preventing the SSE stream from ever seeing an
    // intermediate count (the client would just see 0 jump straight to the
    // final total). Yielding periodically fixes both.
    if (checked % 25 === 0) await new Promise((resolve) => setImmediate(resolve));
  }

  const kindCounts = countClipsByKind(db, opts.clipperId);
  onProgress({
    message: `@${clipper.handle}: ${oshiHits}/${videos.length} oshi, ${kindCounts.short}/${videos.length} shorts`,
  });
}
