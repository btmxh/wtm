import { html, raw } from "../html.ts";
import type { ClipDetail, ClipperSummary, OshiSummary, Tag, TagSummary } from "../queries.ts";
import { oshiPills, tagsBlock, takeawayBlock, metaBlock, filterQueryString, type FilterQuery } from "./watchParts.ts";

// What the client needs per queue entry to build a slide and its up-next
// row - everything else about a clip comes from its server-rendered panel.
export interface FeedItem {
  id: number;
  videoId: string;
  kind: "short" | "video";
  title: string;
}

// The sidebar's per-clip content. Rendered inline for the first clip and
// re-fetched from /clips/:id/panel as the feed scrolls to each next one.
export function clipPanel(clip: ClipDetail, availableTags: Tag[], filters: FilterQuery) {
  return html`
    <h1 class="heading feed-panel__title">
      ${clip.title}
      ${clip.watchedAt != null ? html`<span class="feed-panel__watched-mark" title="watched">&check;</span>` : html``}
    </h1>
    ${oshiPills(clip)}
    ${tagsBlock(clip, availableTags, filters)}
    ${takeawayBlock(clip, filters)}
    ${metaBlock(clip)}
    <details class="detail__description">
      <summary>Description</summary>
      <p>${clip.description}</p>
    </details>
    <a class="feed-panel__yt" href="${clip.url}" target="_blank" rel="noopener">open on YouTube &nearr;</a>
  `;
}

function select(name: string, label: string, current: string | undefined, options: { value: string; label: string }[]) {
  return html`
    <label class="queue-filter__field">
      <span>${label}</span>
      <select name="${name}">
        ${options.map(
          (o) => html`<option value="${o.value}" ${(current ?? "") === o.value ? "selected" : ""}>${o.label}</option>`,
        )}
      </select>
    </label>
  `;
}

export function watchFeedPage(opts: {
  queue: FeedItem[];
  start: number;
  firstPanel: ReturnType<typeof html>;
  filters: FilterQuery;
  oshis: OshiSummary[];
  clippers: ClipperSummary[];
  tags: TagSummary[];
}) {
  const { queue, start, firstPanel, filters, oshis, clippers, tags } = opts;
  const qs = filterQueryString(filters);
  // Inlined as JSON for watch.js; escape "<" so a title can't close the
  // <script> element early.
  const data = JSON.stringify({ queue, start, filters }).replace(/</g, "\\u003c");

  return html`
    <div class="watch-overlay">
      <a class="watch-overlay__close" href="/${qs}" aria-label="Back to shelf">&times;</a>

      <div class="feed">
        <div class="feed__stage" aria-label="Clip feed">
          <div class="feed__track"></div>
        </div>

        <!-- Portrait only: the sidebar collapses into a bottom sheet, and
             this bar is what stays visible under the stage to open it. -->
        <button type="button" class="feed__peek" aria-expanded="false" aria-controls="feed-sidebar">
          <span class="feed__peek-pos">${start + 1} / ${queue.length}</span>
          <span class="feed__peek-title">${queue[start]?.title ?? ""}</span>
          <span class="feed__peek-more" aria-hidden="true">details &uarr;</span>
        </button>
        <div class="feed__scrim" hidden></div>

        <aside class="feed__sidebar" id="feed-sidebar">
          <button type="button" class="feed__sheet-grab" aria-label="Close details"></button>
          <div class="queue-bar">
            <span class="queue-bar__pos">${start + 1} / ${queue.length}</span>
            <details class="queue-filter">
              <summary>filter up next</summary>
              <form class="queue-filter__form" method="get" action="/watch/${queue[start]?.id ?? ""}">
                ${select("oshi", "Oshi", filters.oshi, [
                  { value: "", label: "All" },
                  ...oshis.map((o) => ({ value: String(o.id), label: o.name })),
                ])}
                ${select("kind", "Kind", filters.kind, [
                  { value: "", label: "All" },
                  { value: "short", label: "Shorts" },
                  { value: "video", label: "Videos" },
                ])}
                ${select("watched", "Status", filters.watched, [
                  { value: "", label: "All" },
                  { value: "unwatched", label: "Unwatched" },
                  { value: "watched", label: "Watched" },
                ])}
                ${select("tag", "Tag", filters.tag, [
                  { value: "", label: "All" },
                  ...tags.map((t) => ({ value: String(t.id), label: `${t.name} (${t.clipCount})` })),
                ])}
                ${select("clipper", "Clipper", filters.clipper, [
                  { value: "", label: "All" },
                  ...clippers.map((c) => ({ value: String(c.id), label: c.handle })),
                ])}
                ${select("order", "Order", filters.order, [
                  { value: "", label: "Newest" },
                  { value: "oldest", label: "Oldest" },
                  { value: "random", label: "Shuffle" },
                ])}
                <button type="submit">Apply to up next</button>
              </form>
            </details>
          </div>

          <div class="feed__panel">${firstPanel}</div>

          <section class="up-next" hidden>
            <h2 class="up-next__heading">Up next</h2>
            <ol class="up-next__list"></ol>
          </section>
        </aside>
      </div>
    </div>

    <template id="feed-end-panel">
      <p class="feed-panel__end">That's all for this queue. Loosen the filters to keep going.</p>
    </template>
    <script type="application/json" id="feed-data">${raw(data)}</script>
    <script src="/watch.js" defer></script>
  `;
}
