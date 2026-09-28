import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { openDb } from "./db.ts";
import {
  listOshiSummaries,
  listClipperSummaries,
  listClips,
  oshisForClips,
  getClip,
  markWatched,
  type ClipFilters,
} from "./queries.ts";
import { layout } from "./views/layout.ts";
import { indexPage } from "./views/index.ts";
import { clipPage } from "./views/clip.ts";

const db = openDb();
const app = new Hono();

app.use("/*", serveStatic({ root: "./public" }));

app.get("/", (c) => {
  const q = c.req.query();
  const oshiId = q.oshi ? Number(q.oshi) : undefined;
  const filters: ClipFilters = {
    oshiId,
    clipperId: q.clipper ? Number(q.clipper) : undefined,
    kind: q.kind === "video" || q.kind === "short" ? q.kind : undefined,
    watched: q.watched === "watched" || q.watched === "unwatched" ? q.watched : undefined,
  };

  const oshis = listOshiSummaries(db);
  const clippers = listClipperSummaries(db);
  const clips = listClips(db, filters);
  const oshisByClip = oshisForClips(db, clips.map((c) => c.id));

  const body = indexPage({ clips, oshisByClip, clippers, filters, oshiId });
  return c.html(layout({ title: "wtm", oshis, activeOshiId: oshiId, body }));
});

app.get("/clips/:id", (c) => {
  const id = Number(c.req.param("id"));
  const clip = getClip(db, id);
  if (!clip) return c.notFound();

  const oshis = listOshiSummaries(db);
  const body = clipPage(clip);
  return c.html(layout({ title: clip.title, oshis, body }));
});

app.post("/clips/:id/watch", async (c) => {
  const id = Number(c.req.param("id"));
  const form = await c.req.parseBody();
  const takeaway = String(form.takeaway ?? "").trim();
  if (takeaway) markWatched(db, id, takeaway);
  return c.redirect(`/clips/${id}`, 303);
});

const port = Number(process.env.PORT ?? 4173);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`wtm running at http://localhost:${info.port}`);
});
