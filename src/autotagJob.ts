import type { DatabaseSync } from "node:sqlite";
import {
  listClipsForTagging,
  listTaggableTags,
  listAttachedTagIds,
  setLlmClipTag,
} from "./db.ts";
import { askNouls, type NoulQuestion } from "./typesafe.ts";
import type { JobReport } from "./jobs.ts";

const CONCURRENCY = 5;
// Below this, we'd rather leave a clip untagged than guess wrong - tune
// against observed results.
const THRESHOLD = 0.7;

export async function runAutotag(db: DatabaseSync, onProgress: JobReport): Promise<void> {
  const tags = listTaggableTags(db);
  if (tags.length === 0) {
    onProgress({ message: "no tags have a prompt set - add one via /tags before auto-tagging." });
    return;
  }
  onProgress({ message: `tags: ${tags.map((t) => t.name).join(", ")}` });

  const clips = listClipsForTagging(db);
  onProgress({ total: clips.length, message: `checking ${clips.length} clip(s) against ${tags.length} tag(s)...` });

  let checked = 0;
  let attached = 0;
  let requests = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  async function worker(queue: typeof clips) {
    for (const clip of queue) {
      const attachedIds = listAttachedTagIds(db, clip.id);
      const pending = tags.filter((t) => !attachedIds.has(t.id));
      if (pending.length === 0) {
        checked++;
        onProgress({ current: checked });
        continue;
      }

      const questions: Record<string, NoulQuestion> = {};
      for (const t of pending) {
        questions[String(t.id)] = {
          type: "noul",
          instructions: `Does this clip match the tag "${t.name}"?`,
          criteria: { true: t.prompt, false: `Does not match: ${t.prompt}` },
        };
      }

      const { answers, usage } = await askNouls(
        { title: clip.title, description: clip.description },
        questions,
      );
      requests++;
      inputTokens += usage.inputTokens;
      outputTokens += usage.outputTokens;

      const matched: string[] = [];
      for (const t of pending) {
        const p = answers[String(t.id)];
        if (p == null || p < THRESHOLD) continue;
        setLlmClipTag(db, clip.id, t.id, p);
        matched.push(`${t.name} (${p.toFixed(2)})`);
      }

      const tagSummary = matched.length > 0 ? matched.join(", ") : "(no match)";
      onProgress({
        message:
          `clip ${clip.id} "${clip.title.slice(0, 60)}": ${tagSummary} ` +
          `[${usage.inputTokens}in/${usage.outputTokens}out]`,
      });
      if (matched.length > 0) attached += matched.length;
      checked++;
      onProgress({ current: checked });
    }
  }

  const buckets: (typeof clips)[] = Array.from({ length: CONCURRENCY }, () => []);
  clips.forEach((c, i) => buckets[i % CONCURRENCY].push(c));
  await Promise.all(buckets.map(worker));

  onProgress({ message: `checked ${checked} clip(s), attached ${attached} llm tag(s)` });
  onProgress({
    message: `usage: ${requests} request(s), ${inputTokens} input token(s), ${outputTokens} output token(s)`,
  });
}
