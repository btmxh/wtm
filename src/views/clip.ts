import { html } from "../html.ts";
import { formatDate, formatDuration } from "../format.ts";
import { oshiAccent } from "../oshiColor.ts";
import type { ClipDetail } from "../queries.ts";

export function clipPage(clip: ClipDetail) {
  const watched = clip.watchedAt != null;

  return html`
    <a class="back" href="/">&larr; back to shelf</a>

    <div class="detail detail--${clip.kind}">
      <div class="detail__player">
        <iframe
          src="https://www.youtube.com/embed/${clip.videoId}"
          title="${clip.title}"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
        ></iframe>
      </div>

      <aside class="detail__notes">
        <h1>${clip.title}</h1>

        <div class="detail__oshis">
          ${clip.oshis.map(
            (o) => html`
              <span class="pill" style="--accent: ${oshiAccent(o.name)}">
                <span class="dot"></span>${o.name}
              </span>
            `,
          )}
        </div>

        <dl class="detail__meta">
          <div><dt>Clipper</dt><dd>${clip.clipperHandle}</dd></div>
          <div><dt>Posted</dt><dd>${formatDate(clip.publishedAt)}</dd></div>
          <div><dt>Length</dt><dd>${formatDuration(clip.durationSeconds)}</dd></div>
        </dl>

        <details class="detail__description">
          <summary>Description</summary>
          <p>${clip.description}</p>
        </details>

        <div class="takeaway ${watched ? "takeaway--done" : ""}">
          <form method="post" action="/clips/${clip.id}/watch">
            <label for="takeaway">
              ${watched ? "Your takeaway" : "Write a takeaway to mark this watched"}
            </label>
            <textarea id="takeaway" name="takeaway" rows="4" required>${clip.takeaway ?? ""}</textarea>
            <button type="submit">${watched ? "Update takeaway" : "Mark watched"}</button>
          </form>
          ${watched ? html`<p class="takeaway__stamp">watched ${formatDate(clip.watchedAt!)}</p>` : html``}
        </div>
      </aside>
    </div>
  `;
}
