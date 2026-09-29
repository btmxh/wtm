import { html } from "../html.ts";
import { formatDate, formatDuration } from "../format.ts";
import { oshiAccent } from "../oshiColor.ts";
import type { ClipDetail, Tag } from "../queries.ts";

// The active queue filters, carried through watch mode via query params and
// hidden form fields so mutations (tag/watch) redirect back into the same
// filtered queue instead of resetting it.
export interface FilterQuery {
  oshi?: string;
  clipper?: string;
  tag?: string;
  kind?: "short" | "video";
  watched?: "watched" | "unwatched";
  order?: "oldest" | "random";
  // Only meaningful with order=random - keeps a shuffle stable across
  // reloads and non-JS form round-trips.
  seed?: string;
}

const FILTER_KEYS = ["oshi", "clipper", "tag", "kind", "watched", "order", "seed"] as const;

export function filterQueryString(f: FilterQuery): string {
  const qs = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = f[key];
    if (value) qs.set(key, value);
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

function hiddenFilterInputs(f: FilterQuery) {
  return FILTER_KEYS.map((key) => {
    const value = f[key];
    return value ? html`<input type="hidden" name="${key}" value="${value}" />` : html``;
  });
}

export function oshiPills(clip: ClipDetail) {
  return html`
    <div class="detail__oshis">
      ${clip.oshis.map(
        (o) => html`
          <span class="pill" style="--accent: ${oshiAccent(o.name)}">
            <span class="dot"></span>${o.name}
          </span>
        `,
      )}
    </div>
  `;
}

export function tagsBlock(clip: ClipDetail, availableTags: Tag[], f: FilterQuery) {
  return html`
    <div class="detail__tags">
      ${clip.tags.map(
        (t) => html`
          <form class="tag-pill" method="post" action="/clips/${clip.id}/tags/${t.id}/delete">
            ${hiddenFilterInputs(f)}
            <span>${t.name}</span>
            <button type="submit" aria-label="Remove tag ${t.name}">&times;</button>
          </form>
        `,
      )}
      ${
        availableTags.length > 0
          ? html`
            <form class="tag-add" method="post" action="/clips/${clip.id}/tags">
              ${hiddenFilterInputs(f)}
              <select name="tagId">
                ${availableTags.map((t) => html`<option value="${t.id}">${t.name}</option>`)}
              </select>
              <button type="submit">+</button>
            </form>
          `
          : html``
      }
      <a class="manage-tags-link" href="/tags">manage tags</a>
    </div>
  `;
}

export function takeawayBlock(clip: ClipDetail, f: FilterQuery) {
  const watched = clip.watchedAt != null;
  return html`
    <div class="takeaway ${watched ? "takeaway--done" : ""}">
      <form method="post" action="/clips/${clip.id}/watch">
        ${hiddenFilterInputs(f)}
        <label for="takeaway-${clip.id}">
          ${watched ? "Your takeaway" : "Write a takeaway to mark this watched"}
        </label>
        <textarea id="takeaway-${clip.id}" name="takeaway" rows="3" required>${clip.takeaway ?? ""}</textarea>
        <button type="submit">${watched ? "Update takeaway" : "Mark watched"}</button>
      </form>
      ${watched ? html`<p class="takeaway__stamp">watched ${formatDate(clip.watchedAt!)}</p>` : html``}
    </div>
  `;
}

export function metaBlock(clip: ClipDetail) {
  return html`
    <dl class="detail__meta">
      <div><dt>Clipper</dt><dd>${clip.clipperHandle}</dd></div>
      <div><dt>Posted</dt><dd>${formatDate(clip.publishedAt)}</dd></div>
      <div><dt>Length</dt><dd>${formatDuration(clip.durationSeconds)}</dd></div>
    </dl>
  `;
}
