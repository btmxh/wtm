import { html } from "../html.ts";
import type { Job } from "../jobs.ts";

function statusLabel(status: Job["status"]): string {
  if (status === "running") return "running";
  if (status === "done") return "done";
  return "error";
}

export function jobsListPage(jobs: Job[]) {
  return html`
    <a class="back" href="/">&larr; back to shelf</a>
    <h1 class="heading">Jobs</h1>

    ${jobs.length === 0
      ? html`<p class="empty">No jobs have run yet.</p>`
      : html`
          <ul class="jobs-list">
            ${jobs.map(
              (j) => html`
                <li class="jobs-list__row">
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
  `;
}

export function jobDetailPage(job: Job) {
  const pct = job.progress.total > 0 ? Math.round((job.progress.current / job.progress.total) * 100) : 0;

  return html`
    <a class="back" href="/jobs">&larr; back to jobs</a>

    <div class="job-panel" data-job-id="${job.id}" data-job-status="${job.status}">
      <h1 class="heading">${job.type} job</h1>
      <p class="job-panel__status job-panel__status--${statusLabel(job.status)}">${statusLabel(job.status)}</p>

      <div class="job-panel__bar">
        <div class="job-panel__bar-fill" style="width: ${pct}%"></div>
      </div>
      <p class="job-panel__count">${job.progress.current} / ${job.progress.total || "?"}</p>

      ${job.error ? html`<p class="job-panel__error">${job.error}</p>` : html``}

      <ul class="job-panel__log">
        ${job.log.map((entry) => html`<li>${entry.message}</li>`)}
      </ul>
    </div>

    ${job.status === "running" ? html`<script src="/jobs.js" defer></script>` : html``}
  `;
}
