import { html } from "../html.ts";
import { formatDuration } from "../format.ts";
import { oshiAccent } from "../oshiColor.ts";
import type { ClipFilters, ClipListItem, ClipOshiLink, ClipperSummary, TagSummary } from "../queries.ts";

function clipCard(clip: ClipListItem, oshis: ClipOshiLink[], filterQuery: string) {
  const dots = oshis.map(
    (o) => html`<span class="dot" style="--accent: ${oshiAccent(o.name)}" title="${o.name}"></span>`,
  );

  return html`
    <a
      class="card card--${clip.kind} ${clip.watched ? "card--watched" : "card--unwatched"}"
      href="/watch/${clip.id}${filterQuery}"
    >
      <span class="card__thumb">
        <img src="https://i.ytimg.com/vi/${clip.videoId}/hqdefault.jpg" alt="" loading="lazy" />
        <span class="card__duration">${formatDuration(clip.durationSeconds)}</span>
        ${clip.kind === "short" ? html`<span class="card__short-badge">Short</span>` : html``}
      </span>
      <span class="card__title">${clip.title}</span>
      <span class="card__meta">
        <span class="card__clipper">clipped by ${clip.clipperHandle}</span>
        <span class="card__dots">${dots}</span>
      </span>
    </a>
  `;
}

export function indexPage(opts: {
  clips: ClipListItem[];
  oshisByClip: Map<number, ClipOshiLink[]>;
  clippers: ClipperSummary[];
  tags: TagSummary[];
  filters: ClipFilters;
  oshiId?: number;
  filterQuery: string;
}) {
  const { clips, oshisByClip, clippers, tags, filters, oshiId, filterQuery } = opts;

  const kindOptions: { value: ClipFilters["kind"] | ""; label: string }[] = [
    { value: "", label: "All" },
    { value: "video", label: "Videos" },
    { value: "short", label: "Shorts" },
  ];
  const watchedOptions: { value: ClipFilters["watched"] | ""; label: string }[] = [
    { value: "", label: "All" },
    { value: "unwatched", label: "Unwatched" },
    { value: "watched", label: "Watched" },
  ];

  return html`
    <form class="filter-bar" method="get" action="/">
      ${oshiId != null ? html`<input type="hidden" name="oshi" value="${oshiId}" />` : html``}

      <fieldset class="filter-group">
        ${kindOptions.map(
          (opt) => html`
            <label class="filter-pill">
              <input
                type="radio"
                name="kind"
                value="${opt.value}"
                ${filters.kind === opt.value || (!filters.kind && !opt.value) ? "checked" : ""}
              />
              <span>${opt.label}</span>
            </label>
          `,
        )}
      </fieldset>

      <fieldset class="filter-group">
        ${watchedOptions.map(
          (opt) => html`
            <label class="filter-pill">
              <input
                type="radio"
                name="watched"
                value="${opt.value}"
                ${filters.watched === opt.value || (!filters.watched && !opt.value) ? "checked" : ""}
              />
              <span>${opt.label}</span>
            </label>
          `,
        )}
      </fieldset>

      <label class="filter-select">
        <span>Clipper</span>
        <select name="clipper">
          <option value="">All</option>
          ${clippers.map(
            (c) => html`
              <option value="${c.id}" ${filters.clipperId === c.id ? "selected" : ""}>
                ${c.handle} (${c.clipCount})
              </option>
            `,
          )}
        </select>
      </label>

      <label class="filter-select">
        <span>Tag</span>
        <select name="tag">
          <option value="">All</option>
          ${tags.map(
            (t) => html`
              <option value="${t.id}" ${filters.tagId === t.id ? "selected" : ""}>
                ${t.name} (${t.clipCount})
              </option>
            `,
          )}
        </select>
      </label>

      <button type="submit">Filter</button>
    </form>

    ${
      clips.length === 0
        ? html`<p class="empty">Nothing here yet. Import a clipper, or loosen the filters.</p>`
        : html`<div class="shelf">${clips.map((c) => clipCard(c, oshisByClip.get(c.id) ?? [], filterQuery))}</div>`
    }
  `;
}
