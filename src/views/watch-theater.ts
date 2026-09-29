import { html } from "../html.ts";
import type { ClipDetail, Tag } from "../queries.ts";
import { oshiPills, tagsBlock, takeawayBlock, metaBlock, filterQueryString, type FilterQuery } from "./watchParts.ts";

export function watchTheaterPage(opts: {
  clip: ClipDetail;
  availableTags: Tag[];
  prevId?: number;
  nextId?: number;
  position: { index: number; total: number };
  filters: FilterQuery;
}) {
  const { clip, availableTags, prevId, nextId, position, filters } = opts;
  const qs = filterQueryString(filters);

  return html`
    <div class="watch-overlay">
      <a class="watch-overlay__close" href="/${qs}">&times;</a>

      <div class="theater">
        <div class="theater__player">
          <iframe
            src="https://www.youtube.com/embed/${clip.videoId}?autoplay=1"
            title="${clip.title}"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
          ></iframe>

          <div class="theater__nav">
            ${prevId != null
              ? html`<a class="theater__nav-btn" href="/watch/${prevId}${qs}">&larr; prev</a>`
              : html`<span class="theater__nav-btn theater__nav-btn--disabled">&larr; prev</span>`}
            <span class="theater__position">${position.index + 1} / ${position.total}</span>
            ${nextId != null
              ? html`<a class="theater__nav-btn" href="/watch/${nextId}${qs}">next &rarr;</a>`
              : html`<span class="theater__nav-btn theater__nav-btn--disabled">that's all</span>`}
          </div>
        </div>

        <aside class="theater__sidebar">
          <h1 class="heading">${clip.title}</h1>
          ${oshiPills(clip)}
          ${tagsBlock(clip, availableTags, filters)}
          ${metaBlock(clip)}
          <details class="detail__description">
            <summary>Description</summary>
            <p>${clip.description}</p>
          </details>
          ${takeawayBlock(clip, filters)}
        </aside>
      </div>
    </div>
  `;
}
