import { openDb } from "./db.ts";
import { runAutotag } from "./autotagJob.ts";

async function main() {
  const db = openDb();
  await runAutotag(db, (patch) => {
    if (patch.message) console.log(patch.message);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
