import { Agent, setGlobalDispatcher } from "undici";

// This machine has no working IPv6 route, and undici's default happy-eyeballs
// connect doesn't fall back to IPv4 cleanly here, so every fetch times out.
// Pin the dispatcher to IPv4 only.
setGlobalDispatcher(new Agent({ connect: { family: 4 } }));

const API_BASE = "https://www.googleapis.com/youtube/v3";

function apiKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY is not set (check .env)");
  return key;
}

// Every endpoint this app calls (channels/playlistItems/videos .list) costs
// 1 quota unit per request regardless of which parts are requested - only
// search.list (unused here) costs more (100).
const QUOTA_COST_PER_CALL = 1;

export type QuotaReporter = (units: number) => void;

async function apiGet(path: string, params: Record<string, string>, onQuota?: QuotaReporter, signal?: AbortSignal) {
  const url = new URL(`${API_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", apiKey());

  const res = await fetch(url, { signal });
  onQuota?.(QUOTA_COST_PER_CALL);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API ${path} failed: ${res.status} ${body}`);
  }
  return res.json();
}

export interface ChannelInfo {
  channelId: string;
  title: string;
  description: string;
  uploadsPlaylistId: string;
  // Not present when a channel has never set a handle - callers should fall
  // back to channelId as a unique clippers.handle value in that case.
  handle?: string;
}

// The subset of a channels.list item (part=snippet,contentDetails) we read.
interface ChannelItem {
  id: string;
  snippet: { title: string; description: string; customUrl?: string };
  contentDetails: { relatedPlaylists: { uploads: string } };
}

function channelInfoFromItem(item: ChannelItem): ChannelInfo {
  const customUrl: string | undefined = item.snippet.customUrl;
  return {
    channelId: item.id,
    title: item.snippet.title,
    description: item.snippet.description,
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
    handle: customUrl ? customUrl.replace(/^@/, "") : undefined,
  };
}

export async function resolveChannel(
  handle: string,
  onQuota?: QuotaReporter,
  signal?: AbortSignal,
): Promise<ChannelInfo> {
  const data = await apiGet(
    "channels",
    {
      part: "snippet,contentDetails",
      forHandle: handle,
    },
    onQuota,
    signal,
  );
  const item = data.items?.[0];
  if (!item) throw new Error(`No channel found for handle @${handle}`);
  return channelInfoFromItem(item);
}

export async function resolveChannelById(
  channelId: string,
  onQuota?: QuotaReporter,
  signal?: AbortSignal,
): Promise<ChannelInfo> {
  const data = await apiGet(
    "channels",
    {
      part: "snippet,contentDetails",
      id: channelId,
    },
    onQuota,
    signal,
  );
  const item = data.items?.[0];
  if (!item) throw new Error(`No channel found for id ${channelId}`);
  return channelInfoFromItem(item);
}

export async function resolveChannelForVideo(
  videoId: string,
  onQuota?: QuotaReporter,
  signal?: AbortSignal,
): Promise<ChannelInfo> {
  const data = await apiGet("videos", { part: "snippet", id: videoId }, onQuota, signal);
  const item = data.items?.[0];
  if (!item) throw new Error(`No video found for id ${videoId}`);
  return resolveChannelById(item.snippet.channelId, onQuota, signal);
}

export interface ParsedYoutubeUrl {
  kind: "handle" | "channel" | "video";
  value: string;
}

// Accepts a channel URL (@handle or /channel/UC...) or a video/short URL
// (watch?v=, youtu.be/, /shorts/) and pulls out the bit that identifies it,
// so the caller can decide which resolver to call.
export function parseYoutubeUrl(input: string): ParsedYoutubeUrl {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error(`Not a valid URL: ${input}`);
  }

  if (url.hostname === "youtu.be") {
    const videoId = url.pathname.slice(1).split("/")[0];
    if (videoId) return { kind: "video", value: videoId };
  }

  const parts = url.pathname.split("/").filter(Boolean);

  if (parts[0] === "watch") {
    const videoId = url.searchParams.get("v");
    if (videoId) return { kind: "video", value: videoId };
  }
  if (parts[0] === "shorts" && parts[1]) {
    return { kind: "video", value: parts[1] };
  }
  if (parts[0] === "channel" && parts[1]) {
    return { kind: "channel", value: parts[1] };
  }
  if (parts[0]?.startsWith("@")) {
    return { kind: "handle", value: parts[0].slice(1) };
  }

  throw new Error(`Could not parse a channel or video from: ${input}`);
}

export interface PlaylistVideo {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
}

// snippet is already fetched for title/publishedAt, so description comes
// along in the same response at no extra quota cost.
export async function* fetchPlaylistItems(
  playlistId: string,
  onQuota?: QuotaReporter,
  signal?: AbortSignal,
): AsyncGenerator<PlaylistVideo> {
  let pageToken: string | undefined;

  do {
    const data = await apiGet(
      "playlistItems",
      {
        part: "snippet,contentDetails",
        playlistId,
        maxResults: "50",
        ...(pageToken ? { pageToken } : {}),
      },
      onQuota,
      signal,
    );

    for (const item of data.items ?? []) {
      yield {
        videoId: item.contentDetails.videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        publishedAt: item.contentDetails.videoPublishedAt ?? item.snippet.publishedAt,
      };
    }

    pageToken = data.nextPageToken;
  } while (pageToken);
}

function parseIso8601Duration(duration: string): number {
  const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  const [, h, m, s] = match;
  return (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0);
}

// youtube.com/shorts/{id} serves the page directly (200) for an actual
// Short, and redirects (303) to /watch?v={id} for anything else. This is
// scraping youtube.com itself, not the Data API, so it costs no quota but
// isn't a documented endpoint - keep it out of the main collect path and
// don't hammer it.
export async function checkIsShort(videoId: string, signal?: AbortSignal): Promise<boolean> {
  const res = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
    method: "HEAD",
    redirect: "manual",
    // Without a timeout a single stalled connection ties up a worker slot
    // forever - a classify run over thousands of clips has enough requests
    // that this isn't a hypothetical. Combine with the caller's own signal
    // (e.g. a cancelled job) so either one aborts the request.
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
  });
  return res.status === 200;
}

// A channel with thousands of uploads means thousands of video ids, chunked
// 50-per-request - firing all chunks at once used to queue dozens of
// concurrent requests against the same origin with no feedback until every
// last one landed, which on a slow/rate-limited chunk could sit for minutes
// looking exactly like a hang. Bounded worker pool + a progress callback per
// completed chunk fixes both: gentler on the API, and visible movement.
const DURATION_FETCH_CONCURRENCY = 8;

export async function fetchDurations(
  videoIds: string[],
  onQuota?: QuotaReporter,
  onChunkDone?: (completed: number, totalChunks: number) => void,
  signal?: AbortSignal,
): Promise<Map<string, number>> {
  const chunks: string[][] = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    chunks.push(videoIds.slice(i, i + 50));
  }

  const durations = new Map<string, number>();
  let completed = 0;

  async function worker(queue: string[][]) {
    for (const batch of queue) {
      if (signal?.aborted) return;
      const data = await apiGet("videos", { part: "contentDetails", id: batch.join(",") }, onQuota, signal);
      for (const item of data.items ?? []) {
        durations.set(item.id, parseIso8601Duration(item.contentDetails.duration));
      }
      completed++;
      onChunkDone?.(completed, chunks.length);
    }
  }

  const buckets: string[][][] = Array.from({ length: DURATION_FETCH_CONCURRENCY }, () => []);
  for (const [i, c] of chunks.entries()) buckets[i % DURATION_FETCH_CONCURRENCY].push(c);
  await Promise.all(buckets.map(worker));

  return durations;
}
