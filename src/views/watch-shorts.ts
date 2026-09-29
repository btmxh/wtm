import { html } from "../html.ts";
import type { ClipDetail, Tag } from "../queries.ts";
import {
  oshiPills,
  tagsBlock,
  tagChipsPreview,
  takeawayBlock,
  filterQueryString,
  type FilterQuery,
} from "./watchParts.ts";

export function watchShortsPage(opts: {
  clips: ClipDetail[];
  availableTagsByClip: Map<number, Tag[]>;
  filters: FilterQuery;
}) {
  const { clips, availableTagsByClip, filters } = opts;
  const qs = filterQueryString(filters);

  return html`
    <div class="watch-overlay">
      <a class="watch-overlay__close" href="/${qs}">&times;</a>

      <div class="shorts-feed">
        ${clips.map(
          (clip) => html`
            <section class="shorts-slide" id="short-${clip.id}" data-video-id="${clip.videoId}">
              <div class="shorts-slide__player"></div>
              <button type="button" class="shorts-slide__unmute" hidden>unmute</button>

              <div class="shorts-slide__chrome">
                <h1 class="shorts-slide__title">
                  ${clip.title}
                  ${clip.watchedAt != null ? html`<span class="shorts-slide__watched-mark">&check;</span>` : html``}
                </h1>
                ${oshiPills(clip)}
                ${tagChipsPreview(clip)}

                <details class="shorts-slide__more">
                  <summary>tags &amp; takeaway</summary>
                  <div class="shorts-slide__more-body">
                    ${tagsBlock(clip, availableTagsByClip.get(clip.id) ?? [], filters)}
                    ${takeawayBlock(clip, filters)}
                  </div>
                </details>
              </div>
            </section>
          `,
        )}

        <section class="shorts-slide shorts-slide--end">
          <p>That's all for this queue.</p>
          <a href="/${qs}">&larr; back to shelf</a>
        </section>
      </div>
    </div>

    <script src="/watch.js" defer></script>
  `;
}
