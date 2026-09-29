import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { html } from "./html.ts";
import { openDb, listOshis, upsertOshi } from "./db.ts";
import {
  listOshiSummaries,
  listClipperSummaries,
  listTags,
  listClips,
  oshisForClips,
  getClip,
  markWatched,
  attachTagToClip,
  removeTagFromClip,
  createTag,
  updateTag,
  deleteTag,
  getOverallProgress,
  getTagProgress,
  getOshiTagBreakdown,
  getWatchHeatmap,
  type ClipFilters,
  type ClipListItem,
  type TagProgress,
} from "./queries.ts";
import { layout } from "./views/layout.ts";
import { indexPage } from "./views/index.ts";
import { watchFeedPage, clipPanel, type FeedItem } from "./views/watch-feed.ts";
import { filterQueryString, type FilterQuery } from "./views/watchParts.ts";
import { tagsPage } from "./views/tags.ts";
import { importPage } from "./views/import.ts";
import { jobsListPage, jobDetailPage } from "./views/jobs.ts";
import { statsPage } from "./views/stats.ts";
import { oshisPage, type OshiRowWithCounts } from "./views/oshis.ts";
import { createJob, cancelJob, getJob, listJobs } from "./jobs.ts";
import { resolveClipperFromUrl, runImport, type MatchScope } from "./importJob.ts";
import { runAutotag } from "./autotagJob.ts";
import { runClassify } from "./classifyJob.ts";

function filtersFromQuery(q: Record<string, string>): FilterQuery {
  const order = q.order === "oldest" || q.order === "random" ? q.order : undefined;
  return {
    oshi: q.oshi || undefined,
    clipper: q.clipper || undefined,
    tag: q.tag || undefined,
    kind: q.kind === "short" || q.kind === "video" ? q.kind : undefined,
    watched: q.watched === "watched" || q.watched === "unwatched" ? q.watched : undefined,
    order,
    seed: order === "random" && /^\d+$/.test(q.seed ?? "") ? q.seed : undefined,
  };
}

function filtersFromForm(form: Record<string, unknown>): FilterQuery {
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(form)) if (typeof v === "string") q[k] = v;
  return filtersFromQuery(q);
}

// Deterministic shuffle (mulberry32-driven Fisher-Yates) so a given seed
// always yields the same order - a reload or a non-JS form round-trip lands
// back in the same shuffled queue.
function seededShuffle<T>(items: T[], seed: number): T[] {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function buildQueue(filters: FilterQuery): ClipListItem[] {
  const clips = listClips(db, {
    oshiId: filters.oshi ? Number(filters.oshi) : undefined,
    clipperId: filters.clipper ? Number(filters.clipper) : undefined,
    tagId: filters.tag ? Number(filters.tag) : undefined,
    kind: filters.kind,
    watched: filters.watched,
  });
  if (filters.order === "oldest") clips.reverse();
  else if (filters.order === "random") seededShuffle(clips, Number(filters.seed ?? 0));
  return clips;
}

function toFeedItem(c: { id: number; videoId: string; kind: "short" | "video"; title: string }): FeedItem {
  return { id: c.id, videoId: c.videoId, kind: c.kind, title: c.title };
}

function panelFor(id: number, filters: FilterQuery) {
  const clip = getClip(db, id);
  if (!clip) return undefined;
  const attached = new Set(clip.tags.map((t) => t.id));
  const availableTags = listTags(db).filter((t) => !attached.has(t.id));
  return clipPanel(clip, availableTags, filters);
}

// Mutations from the feed sidebar are posted via fetch (so the playing clip
// isn't torn down by a page load) and only need an ack; plain form posts
// still get the redirect back into watch mode.
function mutationResponse(c: Context, id: number, form: Record<string, unknown>) {
  if (c.req.header("x-wtm-fetch")) return c.body(null, 204);
  return c.redirect(`/watch/${id}${filterQueryString(filtersFromForm(form))}`, 303);
}

// Watch mode embeds a YouTube player, which needs its own domains warmed up
// and (for shorts) the player API fetched as early as possible - watch.js
// only requests it once its own tiny script has parsed and run.
const watchHead = html`
  <link rel="preconnect" href="https://www.youtube.com" />
  <link rel="preconnect" href="https://www.google.com" />
  <link rel="preload" as="script" href="https://www.youtube.com/iframe_api" />
`;

const db = openDb();
const app = new Hono();

app.use("/*", serveStatic({ root: "./public" }));

app.get("/", (c) => {
  const q = c.req.query();
  const oshiId = q.oshi ? Number(q.oshi) : undefined;
  const filters: ClipFilters = {
    oshiId,
    clipperId: q.clipper ? Number(q.clipper) : undefined,
    tagId: q.tag ? Number(q.tag) : undefined,
    kind: q.kind === "video" || q.kind === "short" ? q.kind : undefined,
    watched: q.watched === "watched" || q.watched === "unwatched" ? q.watched : undefined,
  };

  const oshis = listOshiSummaries(db);
  const clippers = listClipperSummaries(db);
  const tags = listTags(db);
  const clips = listClips(db, filters);
  const oshisByClip = oshisForClips(db, clips.map((c) => c.id));
  const filterQuery = filterQueryString(filtersFromQuery(q));

  const body = indexPage({ clips, oshisByClip, clippers, tags, filters, oshiId, filterQuery });
  return c.html(layout({ title: "wtm", oshis, activeOshiId: oshiId, body }));
});

app.get("/watch/:id", (c) => {
  const id = Number(c.req.param("id"));
  const clip = getClip(db, id);
  if (!clip) return c.notFound();

  const filters = filtersFromQuery(c.req.query());
  if (filters.order === "random" && !filters.seed) filters.seed = String(Math.floor(Math.random() * 1e9));

  const queue = buildQueue(filters).map(toFeedItem);
  let start = queue.findIndex((qc) => qc.id === id);
  // A shuffled queue starts at the clip that was clicked; otherwise start
  // wherever it sits so its newer/older neighbors are one swipe away. A clip
  // the filters exclude still gets played first.
  if (start === -1 || filters.order === "random") {
    if (start !== -1) queue.splice(start, 1);
    queue.unshift(toFeedItem(clip));
    start = 0;
  }

  const oshis = listOshiSummaries(db);
  const body = watchFeedPage({
    queue,
    start,
    firstPanel: panelFor(id, filters)!,
    filters,
    oshis,
    clippers: listClipperSummaries(db),
    tags: listTags(db),
  });
  return c.html(layout({ title: clip.title, oshis, body, head: watchHead }));
});

// The feed's "filter up next" - returns the new queue for watch.js to splice
// in after the clip that's currently playing.
app.get("/api/queue", (c) => {
  return c.json(buildQueue(filtersFromQuery(c.req.query())).map(toFeedItem));
});

app.get("/clips/:id/panel", (c) => {
  const panel = panelFor(Number(c.req.param("id")), filtersFromQuery(c.req.query()));
  if (!panel) return c.notFound();
  return c.html(panel.value);
});

app.post("/clips/:id/watch", async (c) => {
  const id = Number(c.req.param("id"));
  const form = await c.req.parseBody();
  const takeaway = String(form.takeaway ?? "").trim();
  if (takeaway) markWatched(db, id, takeaway);
  return mutationResponse(c, id, form);
});

app.post("/clips/:id/tags", async (c) => {
  const id = Number(c.req.param("id"));
  const form = await c.req.parseBody();
  const tagId = Number(form.tagId);
  if (tagId) attachTagToClip(db, id, tagId);
  return mutationResponse(c, id, form);
});

app.post("/clips/:id/tags/:tagId/delete", async (c) => {
  const id = Number(c.req.param("id"));
  const tagId = Number(c.req.param("tagId"));
  const form = await c.req.parseBody();
  removeTagFromClip(db, id, tagId);
  return mutationResponse(c, id, form);
});

app.get("/tags", (c) => {
  const oshis = listOshiSummaries(db);
  const body = tagsPage(listTags(db));
  return c.html(layout({ title: "tags · wtm", oshis, body }));
});

app.post("/tags", async (c) => {
  const form = await c.req.parseBody();
  const name = String(form.name ?? "").trim();
  const prompt = String(form.prompt ?? "").trim();
  if (name) createTag(db, name, prompt || null);
  return c.redirect("/tags", 303);
});

app.post("/tags/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const form = await c.req.parseBody();
  const name = String(form.name ?? "").trim();
  const prompt = String(form.prompt ?? "").trim();
  if (name) updateTag(db, id, name, prompt || null);
  return c.redirect("/tags", 303);
});

app.post("/tags/:id/delete", (c) => {
  const id = Number(c.req.param("id"));
  deleteTag(db, id);
  return c.redirect("/tags", 303);
});

app.get("/oshis", (c) => {
  const oshis = listOshiSummaries(db);
  const rows: OshiRowWithCounts[] = listOshis(db).map((o) => {
    const summary = oshis.find((s) => s.id === o.id);
    return { ...o, clipCount: summary?.clipCount ?? 0, watchedCount: summary?.watchedCount ?? 0 };
  });
  const body = oshisPage(rows);
  return c.html(layout({ title: "oshis · wtm", oshis, body }));
});

app.post("/oshis", async (c) => {
  const form = await c.req.parseBody();
  const name = String(form.name ?? "").trim();
  const aliases = String(form.aliases ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  if (name && aliases.length > 0) upsertOshi(db, name, aliases);
  return c.redirect("/oshis", 303);
});

app.get("/stats", (c) => {
  const oshis = listOshiSummaries(db);
  const overall = getOverallProgress(db);
  const tagProgress = getTagProgress(db);
  const sinceIso = new Date(Date.now() - 20 * 7 * 24 * 60 * 60 * 1000).toISOString();
  const heatmapDays = getWatchHeatmap(db, sinceIso);
  const oshiBreakdowns = new Map<number, TagProgress[]>(oshis.map((o) => [o.id, getOshiTagBreakdown(db, o.id)]));

  const body = statsPage({ overall, oshis, tagProgress, heatmapDays, oshiBreakdowns });
  return c.html(layout({ title: "progress · wtm", oshis, body }));
});

app.get("/import", (c) => {
  const q = c.req.query();
  const oshis = listOshiSummaries(db);
  const oshiRows = listOshis(db);

  const resolved =
    q.clipperId && q.handle && q.title
      ? { clipperId: Number(q.clipperId), handle: q.handle, title: q.title }
      : undefined;

  const body = importPage({ oshis: oshiRows, resolved, error: q.error });
  return c.html(layout({ title: "import · wtm", oshis, body }));
});

app.post("/import/resolve", async (c) => {
  const form = await c.req.parseBody();
  const url = String(form.url ?? "").trim();
  try {
    const resolved = await resolveClipperFromUrl(db, url);
    const qs = new URLSearchParams({
      clipperId: String(resolved.clipperId),
      handle: resolved.handle,
      title: resolved.title,
    });
    return c.redirect(`/import?${qs}`, 303);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.redirect(`/import?error=${encodeURIComponent(message)}`, 303);
  }
});

app.post("/import/oshis", async (c) => {
  const form = await c.req.parseBody();
  const name = String(form.name ?? "").trim();
  const aliases = String(form.aliases ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  if (name && aliases.length > 0) upsertOshi(db, name, aliases);

  const qs = new URLSearchParams();
  if (form.clipperId) qs.set("clipperId", String(form.clipperId));
  if (form.handle) qs.set("handle", String(form.handle));
  if (form.title) qs.set("title", String(form.title));
  return c.redirect(`/import?${qs}`, 303);
});

app.post("/jobs/import", async (c) => {
  const form = await c.req.parseBody({ all: true });
  const clipperId = Number(form.clipperId);
  const oshiIdField = form.oshiId;
  const oshiIds = (Array.isArray(oshiIdField) ? oshiIdField : oshiIdField ? [oshiIdField] : []).map(Number);
  const matchScope = (form.matchScope === "title" ? "title" : "title+description") as MatchScope;

  const job = createJob("import", async (report, signal) => {
    await runImport(db, { clipperId, oshiIds, matchScope }, report, signal);
    // New clips land unverified (heuristic-only kind) - chase them with a
    // classify run right away instead of leaving that for a manual click.
    // A separate job (not folded into this one) so it keeps its own
    // progress/log/id like any other classify run.
    if (!signal.aborted) {
      createJob("classify", (r, s) => runClassify(db, r, s));
    }
  });
  return c.redirect(`/jobs/${job.id}`, 303);
});

app.post("/jobs/autotag", (c) => {
  const job = createJob("autotag", (report, signal) => runAutotag(db, report, signal));
  return c.redirect(`/jobs/${job.id}`, 303);
});

app.post("/jobs/classify", (c) => {
  const job = createJob("classify", (report, signal) => runClassify(db, report, signal));
  return c.redirect(`/jobs/${job.id}`, 303);
});

app.post("/jobs/:id/cancel", (c) => {
  const id = c.req.param("id");
  cancelJob(id);
  return c.redirect(`/jobs/${id}`, 303);
});

app.get("/jobs", (c) => {
  const oshis = listOshiSummaries(db);
  const body = jobsListPage(listJobs());
  return c.html(layout({ title: "jobs · wtm", oshis, body }));
});

app.get("/jobs/events", (c) => {
  return streamSSE(c, async (stream) => {
    let lastSnapshot = "";
    while (!stream.aborted) {
      const snapshot = JSON.stringify(listJobs());
      if (snapshot !== lastSnapshot) {
        await stream.writeSSE({ data: snapshot });
        lastSnapshot = snapshot;
      }
      await stream.sleep(750);
    }
  });
});

app.get("/jobs/:id", (c) => {
  const id = c.req.param("id");
  const job = getJob(id);
  if (!job) return c.notFound();
  const oshis = listOshiSummaries(db);
  const body = jobDetailPage(job);
  return c.html(layout({ title: `${job.type} job · wtm`, oshis, body }));
});

app.get("/jobs/:id/events", (c) => {
  const id = c.req.param("id");
  return streamSSE(c, async (stream) => {
    let lastSnapshot = "";
    while (!stream.aborted) {
      const job = getJob(id);
      if (!job) break;

      const snapshot = JSON.stringify(job);
      if (snapshot !== lastSnapshot) {
        await stream.writeSSE({ data: snapshot });
        lastSnapshot = snapshot;
      }
      if (job.status !== "running") break;
      await stream.sleep(750);
    }
  });
});

const port = Number(process.env.PORT ?? 4173);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`wtm running at http://localhost:${info.port}`);
});
