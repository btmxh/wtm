import { html } from "../html.ts";
import type { TagSummary } from "../queries.ts";

export function tagsPage(tags: TagSummary[]) {
  return html`
    <a class="back" href="/">&larr; back to shelf</a>

    <div class="tags-manage">
      <h1 class="heading">Tags</h1>

      <form class="run-autotag" method="post" action="/jobs/autotag">
        <button type="submit">Run autotagging</button>
        <a class="run-autotag__jobs-link" href="/jobs">view job history</a>
      </form>

      ${tags.length === 0
        ? html`<p class="empty">No tags yet - add one below.</p>`
        : html`
            <ul class="tag-list">
              ${tags.map(
                (t) => html`
                  <li class="tag-row">
                    <form class="tag-row__edit" method="post" action="/tags/${t.id}">
                      <div class="tag-row__fields">
                        <input type="text" name="name" value="${t.name}" required />
                        <textarea name="prompt" rows="3" placeholder="LLM prompt (optional)">${t.prompt ?? ""}</textarea>
                      </div>
                      <div class="tag-row__actions">
                        <span class="tag-row__count">${t.clipCount} clip${t.clipCount === 1 ? "" : "s"}</span>
                        <button type="submit">Save</button>
                      </div>
                    </form>
                    <form class="tag-row__delete-form" method="post" action="/tags/${t.id}/delete">
                      <button type="submit" class="tag-row__delete">Delete</button>
                    </form>
                  </li>
                `,
              )}
            </ul>
          `}

      <form class="tag-create" method="post" action="/tags">
        <div class="tag-create__fields">
          <input type="text" name="name" placeholder="new tag name" required />
          <textarea name="prompt" rows="3" placeholder="LLM prompt (optional)"></textarea>
        </div>
        <button type="submit">Add tag</button>
      </form>
    </div>
  `;
}
