import { openDb, listUnverifiedClips, setVerifiedKind } from "./db.ts";
import { checkIsShort } from "./youtube.ts";

const CONCURRENCY = 5;

async function main() {
  const db = openDb();
  const clips = listUnverifiedClips(db);
  console.log(`checking ${clips.length} unverified clip(s) against youtube.com/shorts/...`);

  let checked = 0;
  let flipped = 0;

  async function worker(queue: typeof clips) {
    for (const clip of queue) {
      const kind = (await checkIsShort(clip.videoId)) ? "short" : "video";
      if (kind !== clip.kind) {
        flipped++;
        console.log(`  ${clip.videoId}: duration heuristic said ${clip.kind}, actually ${kind}`);
      }
      setVerifiedKind(db, clip.id, kind);
      checked++;
    }
  }

  const buckets: (typeof clips)[] = Array.from({ length: CONCURRENCY }, () => []);
  clips.forEach((c, i) => buckets[i % CONCURRENCY].push(c));
  await Promise.all(buckets.map(worker));

  console.log(`checked ${checked}, reclassified ${flipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
