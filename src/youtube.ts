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

async function apiGet(path: string, params: Record<string, string>) {
  const url = new URL(`${API_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", apiKey());

  const res = await fetch(url);
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

function channelInfoFromItem(item: any): ChannelInfo {
  const customUrl: string | undefined = item.snippet.customUrl;
  return {
    channelId: item.id,
    title: item.snippet.title,
    description: item.snippet.description,
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
    handle: customUrl ? customUrl.replace(/^@/, "") : undefined,
  };
}

export async function resolveChannel(handle: string): Promise<ChannelInfo> {
  const data = await apiGet("channels", {
    part: "snippet,contentDetails",
    forHandle: handle,
  });
  const item = data.items?.[0];
  if (!item) throw new Error(`No channel found for handle @${handle}`);
  return channelInfoFromItem(item);
}

export async function resolveChannelById(channelId: string): Promise<ChannelInfo> {
  const data = await apiGet("channels", {
    part: "snippet,contentDetails",
    id: channelId,
  });
  const item = data.items?.[0];
  if (!item) throw new Error(`No channel found for id ${channelId}`);
  return channelInfoFromItem(item);
}

export async function resolveChannelForVideo(videoId: string): Promise<ChannelInfo> {
  const data = await apiGet("videos", { part: "snippet", id: videoId });
  const item = data.items?.[0];
  if (!item) throw new Error(`No video found for id ${videoId}`);
  return resolveChannelById(item.snippet.channelId);
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
): AsyncGenerator<PlaylistVideo> {
  let pageToken: string | undefined;

  do {
    const data = await apiGet("playlistItems", {
      part: "snippet,contentDetails",
      playlistId,
      maxResults: "50",
      ...(pageToken ? { pageToken } : {}),
    });

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
  const match = duration.match(
    /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/,
  );
  if (!match) return 0;
  const [, h, m, s] = match;
  return (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0);
}

// youtube.com/shorts/{id} serves the page directly (200) for an actual
// Short, and redirects (303) to /watch?v={id} for anything else. This is
// scraping youtube.com itself, not the Data API, so it costs no quota but
// isn't a documented endpoint - keep it out of the main collect path and
// don't hammer it.
export async function checkIsShort(videoId: string): Promise<boolean> {
  const res = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
    method: "HEAD",
    redirect: "manual",
  });
  return res.status === 200;
}

export async function fetchDurations(
  videoIds: string[],
): Promise<Map<string, number>> {
  const chunks: string[][] = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    chunks.push(videoIds.slice(i, i + 50));
  }

  const responses = await Promise.all(
    chunks.map((batch) =>
      apiGet("videos", { part: "contentDetails", id: batch.join(",") }),
    ),
  );

  const durations = new Map<string, number>();
  for (const data of responses) {
    for (const item of data.items ?? []) {
      durations.set(item.id, parseIso8601Duration(item.contentDetails.duration));
    }
  }

  return durations;
}
