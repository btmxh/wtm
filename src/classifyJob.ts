import type { DatabaseSync } from "node:sqlite";
import { listUnverifiedClips, setVerifiedKind } from "./db.ts";
import { checkIsShort } from "./youtube.ts";
import type { JobReport } from "./jobs.ts";

const CONCURRENCY = 5;

export async function runClassify(db: DatabaseSync, onProgress: JobReport, signal: AbortSignal): Promise<void> {
  const clips = listUnverifiedClips(db);
  onProgress({
    total: clips.length,
    message: `checking ${clips.length} unverified clip(s) against youtube.com/shorts/...`,
  });

  let checked = 0;
  let flipped = 0;
  let failed = 0;

  async function worker(queue: typeof clips) {
    for (const clip of queue) {
      if (signal.aborted) return;

      // A single transient network error (DNS hiccup, reset, etc.) used to
      // reject this worker's whole Promise.all bucket, killing the entire
      // job immediately while its sibling workers kept silently running in
      // the background - the job showed "error" on screen but was still
      // mutating progress underneath. Leave the clip unverified (it'll be
      // retried on the next run) and keep going instead.
      try {
        const kind = (await checkIsShort(clip.videoId, signal)) ? "short" : "video";
        if (kind !== clip.kind) {
          flipped++;
          onProgress({
            message: `${clip.videoId}: duration heuristic said ${clip.kind}, actually ${kind}`,
            metaDelta: { reclassified: 1 },
          });
        }
        setVerifiedKind(db, clip.id, kind);
      } catch (err) {
        if (signal.aborted) return;
        failed++;
        const reason = err instanceof Error ? err.message : String(err);
        onProgress({ message: `${clip.videoId}: skipped (${reason}), will retry next run` });
      }
      checked++;
      onProgress({ current: checked });
    }
  }

  const buckets: (typeof clips)[] = Array.from({ length: CONCURRENCY }, () => []);
  clips.forEach((c, i) => buckets[i % CONCURRENCY].push(c));
  await Promise.all(buckets.map(worker));

  onProgress({
    message: `checked ${checked}, reclassified ${flipped}${failed > 0 ? `, ${failed} failed (will retry next run)` : ""}`,
  });
}
