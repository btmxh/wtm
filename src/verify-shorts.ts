import { openDb } from "./db.ts";
import { runClassify } from "./classifyJob.ts";

async function main() {
  const db = openDb();
  await runClassify(
    db,
    (patch) => {
      if (patch.message) console.log(patch.message);
    },
    new AbortController().signal,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
