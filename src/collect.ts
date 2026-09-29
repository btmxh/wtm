import { readFile } from "node:fs/promises";
import { resolveChannel } from "./youtube.ts";
import { openDb, upsertOshi, listOshis, upsertClipper } from "./db.ts";
import { runImport } from "./importJob.ts";

interface ClipperConfig {
  handle: string;
}

interface OshiConfig {
  name: string;
  aliases: string[];
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
      return clipperId;
    }),
  );

  for (const clipperId of clippers) {
    await runImport(
      db,
      { clipperId, oshiIds: oshis.map((o) => o.id), matchScope: "title+description" },
      (patch) => {
        if (patch.message) console.log(`  ${patch.message}`);
      },
    );
  }

  console.log(`db: data/wtm.sqlite`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
