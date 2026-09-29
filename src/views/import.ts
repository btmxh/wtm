import { html } from "../html.ts";
import type { OshiRow } from "../db.ts";

export interface ResolvedClipperInfo {
  clipperId: number;
  handle: string;
  title: string;
}

export function importPage(opts: { oshis: OshiRow[]; resolved?: ResolvedClipperInfo; error?: string }) {
  const { oshis, resolved, error } = opts;

  return html`
    <a class="back" href="/">&larr; back to shelf</a>
    <h1 class="heading">Import</h1>

    <form class="import-form" method="post" action="/import/resolve">
      <label>
        <span>Channel or video URL</span>
        <input type="text" name="url" placeholder="https://www.youtube.com/@handle or a video URL" required />
      </label>
      <button type="submit">Resolve</button>
    </form>

    ${error ? html`<p class="import-form__error">${error}</p>` : html``}
    ${resolved ? resolvedPanel(resolved, oshis) : html``}
  `;
}

function resolvedPanel(resolved: ResolvedClipperInfo, oshis: OshiRow[]) {
  return html`
    <div class="import-form__resolved">
      <p>Found clipper <strong>${resolved.title}</strong> (@${resolved.handle}) - ready to import.</p>

      <form method="post" action="/jobs/import">
        <input type="hidden" name="clipperId" value="${resolved.clipperId}" />

        <fieldset class="oshi-checkboxes">
          <legend>Auto-tag matches for</legend>
          <p class="oshi-checkboxes__hint">
            Every video/short from this channel is imported no matter what's checked here - this only decides which
            oshis get automatically tagged onto matching clips. Unchecking an oshi does <strong>not</strong> exclude
            their clips, it just leaves them untagged.
          </p>
          ${oshis.length === 0
            ? html`<p class="empty">No oshis yet - add one below.</p>`
            : oshis.map(
                (o) => html`
                  <label class="filter-pill">
                    <input type="checkbox" name="oshiId" value="${o.id}" checked />
                    <span>${o.name}</span>
                  </label>
                `,
              )}
        </fieldset>

        <fieldset class="scope-toggle">
          <legend>Match scope</legend>
          <label class="filter-pill">
            <input type="radio" name="matchScope" value="title+description" checked />
            <span>Title + description</span>
          </label>
          <label class="filter-pill">
            <input type="radio" name="matchScope" value="title" />
            <span>Title only</span>
          </label>
        </fieldset>

        <button type="submit">Start import</button>
      </form>

      <details class="import-form__add-oshi">
        <summary>Add a new oshi</summary>
        <form method="post" action="/import/oshis">
          <input type="hidden" name="clipperId" value="${resolved.clipperId}" />
          <input type="hidden" name="handle" value="${resolved.handle}" />
          <input type="hidden" name="title" value="${resolved.title}" />
          <label>
            <span>Name</span>
            <input type="text" name="name" required />
          </label>
          <label>
            <span>Aliases (comma-separated)</span>
            <input type="text" name="aliases" placeholder="name, nickname, hashtag" required />
          </label>
          <button type="submit">Add oshi</button>
        </form>
      </details>
    </div>
  `;
}
