import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
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
  type TagProgress,
} from "./queries.ts";
import { layout } from "./views/layout.ts";
import { indexPage } from "./views/index.ts";
import { watchShortsPage } from "./views/watch-shorts.ts";
import { watchTheaterPage } from "./views/watch-theater.ts";
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
  return {
    oshi: q.oshi || undefined,
    clipper: q.clipper || undefined,
    tag: q.tag || undefined,
    watched: q.watched === "watched" || q.watched === "unwatched" ? q.watched : undefined,
  };
}

function filtersFromForm(form: Record<string, unknown>): FilterQuery {
  return filtersFromQuery({
    oshi: form.oshi ? String(form.oshi) : "",
    clipper: form.clipper ? String(form.clipper) : "",
    tag: form.tag ? String(form.tag) : "",
    watched: form.watched ? String(form.watched) : "",
  });
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
  const queueFilters: ClipFilters = {
    oshiId: filters.oshi ? Number(filters.oshi) : undefined,
    clipperId: filters.clipper ? Number(filters.clipper) : undefined,
    tagId: filters.tag ? Number(filters.tag) : undefined,
    kind: clip.kind,
    watched: filters.watched,
  };
  const queueClips = listClips(db, queueFilters);
  const index = queueClips.findIndex((qc) => qc.id === id);

  const oshis = listOshiSummaries(db);
  const allTags = listTags(db);

  if (clip.kind === "short") {
    const details = queueClips.map((qc) => getClip(db, qc.id)!);
    const availableTagsByClip = new Map(
      details.map((d) => [d.id, allTags.filter((t) => !d.tags.some((dt) => dt.id === t.id))]),
    );
    const body = watchShortsPage({ clips: details, availableTagsByClip, filters });
    return c.html(layout({ title: clip.title, oshis, body, head: watchHead }));
  }

  const prevId = index > 0 ? queueClips[index - 1].id : undefined;
  const nextId = index >= 0 && index < queueClips.length - 1 ? queueClips[index + 1].id : undefined;
  const attachedTagIds = new Set(clip.tags.map((t) => t.id));
  const availableTags = allTags.filter((t) => !attachedTagIds.has(t.id));

  const body = watchTheaterPage({
    clip,
    availableTags,
    prevId,
    nextId,
    position: { index: Math.max(index, 0), total: queueClips.length },
    filters,
  });
  return c.html(layout({ title: clip.title, oshis, body, head: watchHead }));
});

app.post("/clips/:id/watch", async (c) => {
  const id = Number(c.req.param("id"));
  const form = await c.req.parseBody();
  const takeaway = String(form.takeaway ?? "").trim();
  if (takeaway) markWatched(db, id, takeaway);
  return c.redirect(`/watch/${id}${filterQueryString(filtersFromForm(form))}#short-${id}`, 303);
});

app.post("/clips/:id/tags", async (c) => {
  const id = Number(c.req.param("id"));
  const form = await c.req.parseBody();
  const tagId = Number(form.tagId);
  if (tagId) attachTagToClip(db, id, tagId);
  return c.redirect(`/watch/${id}${filterQueryString(filtersFromForm(form))}#short-${id}`, 303);
});

app.post("/clips/:id/tags/:tagId/delete", async (c) => {
  const id = Number(c.req.param("id"));
  const tagId = Number(c.req.param("tagId"));
  const form = await c.req.parseBody();
  removeTagFromClip(db, id, tagId);
  return c.redirect(`/watch/${id}${filterQueryString(filtersFromForm(form))}#short-${id}`, 303);
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

app.get("/jobs", (c) => {
  const oshis = listOshiSummaries(db);
  const body = jobsListPage(listJobs());
  return c.html(layout({ title: "jobs · wtm", oshis, body }));
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
app.post("/jobs/:id/cancel", (c) => {
  const id = c.req.param("id");
  cancelJob(id);
  return c.redirect(`/jobs/${id}`, 303);
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

