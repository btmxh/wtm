import { html } from "../html.ts";
import type { OshiRow } from "../db.ts";

export interface OshiRowWithCounts extends OshiRow {
  clipCount: number;
  watchedCount: number;
}

export function oshisPage(oshis: OshiRowWithCounts[]) {
  return html`
    <a class="back" href="/">&larr; back to shelf</a>

    <div class="tags-manage">
      <h1 class="heading">Oshis</h1>

      ${
        oshis.length === 0
          ? html`<p class="empty">No oshis yet - add one below.</p>`
          : html`
            <ul class="tag-list">
              ${oshis.map(
                (o) => html`
                  <li class="tag-row">
                    <div class="tag-row__edit">
                      <div class="tag-row__fields">
                        <span class="tag-row__fields-name">${o.name}</span>
                        <span class="tag-row__fields-aliases">${o.aliases.join(", ")}</span>
                      </div>
                    </div>
                    <div class="tag-row__actions">
                      <span class="tag-row__count"
                        >${o.watchedCount}/${o.clipCount} watched</span
                      >
                    </div>
                  </li>
                `,
              )}
            </ul>
          `
      }

      <form class="tag-create" method="post" action="/oshis">
        <div class="tag-create__fields">
          <input type="text" name="name" placeholder="oshi name" required />
          <input type="text" name="aliases" placeholder="aliases, comma-separated (nicknames, hashtags)" required />
        </div>
        <button type="submit">Add oshi</button>
      </form>
    </div>
  `;
}
