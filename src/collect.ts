import { readFile } from "node:fs/promises";
import {
  resolveChannel,
  fetchPlaylistItems,
  fetchDurations,
  type PlaylistVideo,
} from "./youtube.ts";
import {
  openDb,
  upsertOshi,
  listOshis,
  upsertClipper,
  upsertClip,
  setHeuristicClipOshis,
  countClipsByKind,
  type OshiRow,
} from "./db.ts";

interface ClipperConfig {
  handle: string;
}

interface OshiConfig {
  name: string;
  aliases: string[];
}

// YouTube's public API doesn't expose an explicit "is this a Short" flag.
// Duration <= 60s is the standard heuristic; it'll misclassify the small
// number of post-2024 long-form Shorts (up to 3min), good enough for now.
const SHORT_MAX_SECONDS = 60;

function matchingOshis(title: string, description: string, oshis: OshiRow[]): OshiRow[] {
  const haystack = `${title}\n${description}`.toLowerCase();
  return oshis.filter((o) => o.aliases.some((a) => haystack.includes(a.toLowerCase())));
}

async function main() {
  const db = openDb();

  const oshiConfigs: OshiConfig[] = JSON.parse(
    await readFile(new URL("../config/oshis.json", import.meta.url), "utf-8"),
  );
  for (const o of oshiConfigs) upsertOshi(db, o.name, o.aliases);
  const oshis = listOshis(db);
  console.log(`oshis: ${oshis.map((o) => o.name).join(", ")}`);

  const clipperConfigs: ClipperConfig[] = JSON.parse(
    await readFile(new URL("../config/clippers.json", import.meta.url), "utf-8"),
  );

  // Resolve all channels concurrently — YouTube's forHandle lookup can't be
  // batched into one call, so parallelize the round trips instead.
  const clippers = await Promise.all(
    clipperConfigs.map(async (config) => {
      const channel = await resolveChannel(config.handle);
      const clipperId = upsertClipper(db, {
        handle: config.handle,
        channelId: channel.channelId,
        title: channel.title,
        uploadsPlaylistId: channel.uploadsPlaylistId,
      });
      console.log(`resolved @${config.handle} -> ${channel.title} (${channel.channelId})`);
      return { clipperId, handle: config.handle, uploadsPlaylistId: channel.uploadsPlaylistId };
    }),
  );

  // Fetch each clipper's uploads playlist concurrently.
  const clipperVideos = await Promise.all(
    clippers.map(async (c) => {
      const videos: PlaylistVideo[] = [];
      for await (const v of fetchPlaylistItems(c.uploadsPlaylistId)) videos.push(v);
      console.log(`@${c.handle}: ${videos.length} uploads`);
      return { ...c, videos };
    }),
  );

  // Batch duration lookups (videos.list, 50 ids/call) across ALL clippers
  // together, instead of once per clipper.
  const allVideoIds = clipperVideos.flatMap((c) => c.videos.map((v) => v.videoId));
  const durations = await fetchDurations(allVideoIds);

  for (const c of clipperVideos) {
    let oshiHits = 0;

    for (const v of c.videos) {
      const durationSeconds = durations.get(v.videoId) ?? 0;
      const kind = durationSeconds <= SHORT_MAX_SECONDS ? "short" : "video";

      const clipId = upsertClip(db, {
        videoId: v.videoId,
        clipperId: c.clipperId,
        title: v.title,
        description: v.description,
        url: `https://www.youtube.com/watch?v=${v.videoId}`,
        publishedAt: v.publishedAt,
        durationSeconds,
        kind,
      });

      const matched = matchingOshis(v.title, v.description, oshis);
      if (matched.length > 0) oshiHits++;
      setHeuristicClipOshis(
        db,
        clipId,
        matched.map((o) => o.id),
      );
    }

    const kindCounts = countClipsByKind(db, c.clipperId);
    console.log(
      `@${c.handle}: ${oshiHits}/${c.videos.length} oshi, ${kindCounts.short}/${c.videos.length} shorts`,
    );
  }

  console.log(`db: data/wtm.sqlite`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
