import { html } from "../html.ts";
import type { Job } from "../jobs.ts";

function statusLabel(status: Job["status"]): string {
  if (status === "running") return "running";
  if (status === "done") return "done";
  if (status === "cancelled") return "cancelled";
  return "error";
}

export function jobsListPage(jobs: Job[]) {
  return html`
    <a class="back" href="/">&larr; back to shelf</a>
    <h1 class="heading">Jobs</h1>

    <div class="job-triggers">
      <form method="post" action="/jobs/classify">
        <button type="submit">Classify shorts/videos</button>
      </form>
      <form method="post" action="/jobs/autotag">
        <button type="submit">Run autotagging</button>
      </form>
    </div>

    ${jobs.length === 0
      ? html`<p class="empty">No jobs have run yet.</p>`
      : html`
          <ul class="jobs-list">
            ${jobs.map(
              (j) => html`
                <li class="jobs-list__row" data-job-id="${j.id}">
                  <a class="jobs-list__link" href="/jobs/${j.id}">
                    <span class="job-panel__status job-panel__status--${statusLabel(j.status)}">
                      ${statusLabel(j.status)}
                    </span>
                    <span class="jobs-list__type">${j.type}</span>
                    <span class="jobs-list__progress">${j.progress.current}/${j.progress.total || "?"}</span>
                    <span class="jobs-list__time">${j.startedAt}</span>
                  </a>
                </li>
              `,
            )}
          </ul>
        `}

    ${jobs.some((j) => j.status === "running") ? html`<script src="/jobs-list.js" defer></script>` : html``}
  `;
}

// $0.042 per input MTok, TypeSafe only bills input tokens for this model.
const TYPESAFE_INPUT_COST_PER_MTOK = 0.042;

function typesafeCost(inputTokens: number): string {
  return `$${((inputTokens / 1_000_000) * TYPESAFE_INPUT_COST_PER_MTOK).toFixed(4)}`;
}

export function jobDetailPage(job: Job) {
  const pct = job.progress.total > 0 ? Math.round((job.progress.current / job.progress.total) * 100) : 0;

  return html`
    <a class="back" href="/jobs">&larr; back to jobs</a>

    <div class="job-panel" data-job-id="${job.id}" data-job-status="${job.status}">
      <h1 class="heading">${job.type} job</h1>
      <p class="job-panel__status job-panel__status--${statusLabel(job.status)}">${statusLabel(job.status)}</p>

      ${job.status === "running"
        ? html`
            <form class="job-panel__cancel-form" method="post" action="/jobs/${job.id}/cancel">
              <button type="submit" class="job-panel__cancel">Cancel job</button>
            </form>
          `
        : html``}

      <div class="job-panel__bar">
        <div class="job-panel__bar-fill" style="width: ${pct}%"></div>
      </div>
      <p class="job-panel__count">${job.progress.current} / ${job.progress.total || "?"}</p>

      <ul class="job-panel__stats">
        ${job.type === "import"
          ? html`
              <li class="job-panel__stat">
                YouTube quota: <strong class="job-panel__stat-value--quota">${job.meta.youtubeQuotaUnits ?? 0}</strong>
                units
              </li>
            `
          : html``}
        ${job.type === "autotag"
          ? html`
              <li class="job-panel__stat">
                TypeSafe tokens:
                <strong class="job-panel__stat-value--tokens-in">${job.meta.typesafeInputTokens ?? 0}</strong> in /
                <strong class="job-panel__stat-value--tokens-out">${job.meta.typesafeOutputTokens ?? 0}</strong> out
                (~<strong class="job-panel__stat-value--cost">${typesafeCost(job.meta.typesafeInputTokens ?? 0)}</strong>)
              </li>
            `
          : html``}
        ${job.type === "classify"
          ? html`
              <li class="job-panel__stat">
                Reclassified: <strong class="job-panel__stat-value--reclassified">${job.meta.reclassified ?? 0}</strong>
                video(s) the duration heuristic got wrong (1 req/video, no quota cost)
              </li>
            `
          : html``}
      </ul>

      ${job.error ? html`<p class="job-panel__error">${job.error}</p>` : html``}

      <ul class="job-panel__log">
        ${job.log.map((entry) => html`<li>${entry.message}</li>`)}
      </ul>
    </div>

    ${job.status === "running" ? html`<script src="/jobs.js" defer></script>` : html``}
  `;
}
