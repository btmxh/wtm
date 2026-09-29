(() => {
  const panel = document.querySelector(".job-panel");
  if (!panel) return;

  const jobId = panel.dataset.jobId;
  const statusEl = panel.querySelector(".job-panel__status");
  const barFillEl = panel.querySelector(".job-panel__bar-fill");
  const countEl = panel.querySelector(".job-panel__count");
  const logEl = panel.querySelector(".job-panel__log");
  const quotaEl = panel.querySelector(".job-panel__stat-value--quota");
  const tokensInEl = panel.querySelector(".job-panel__stat-value--tokens-in");
  const tokensOutEl = panel.querySelector(".job-panel__stat-value--tokens-out");
  const costEl = panel.querySelector(".job-panel__stat-value--cost");
  const reclassifiedEl = panel.querySelector(".job-panel__stat-value--reclassified");
  const cancelFormEl = panel.querySelector(".job-panel__cancel-form");

  // Same rate as the server-rendered initial value (src/views/jobs.ts) -
  // TypeSafe only bills input tokens for this model.
  const TYPESAFE_INPUT_COST_PER_MTOK = 0.042;

  let renderedLogCount = logEl.children.length;

  function applyJob(job) {
    statusEl.textContent = job.status;
    statusEl.className = `job-panel__status job-panel__status--${job.status}`;

    const pct = job.progress.total > 0 ? Math.round((job.progress.current / job.progress.total) * 100) : 0;
    barFillEl.style.width = `${pct}%`;
    countEl.textContent = `${job.progress.current} / ${job.progress.total || "?"}`;

    if (quotaEl) quotaEl.textContent = job.meta.youtubeQuotaUnits ?? 0;
    if (tokensInEl) tokensInEl.textContent = job.meta.typesafeInputTokens ?? 0;
    if (tokensOutEl) tokensOutEl.textContent = job.meta.typesafeOutputTokens ?? 0;
    if (costEl) {
      const inputTokens = job.meta.typesafeInputTokens ?? 0;
      costEl.textContent = `$${((inputTokens / 1_000_000) * TYPESAFE_INPUT_COST_PER_MTOK).toFixed(4)}`;
    }
    if (reclassifiedEl) reclassifiedEl.textContent = job.meta.reclassified ?? 0;
    if (cancelFormEl && job.status !== "running") cancelFormEl.remove();

    for (let i = renderedLogCount; i < job.log.length; i++) {
      const li = document.createElement("li");
      li.textContent = job.log[i].message;
      logEl.appendChild(li);
    }
    renderedLogCount = job.log.length;

    if (job.status !== "running") {
      source.close();
    }
  }

  const source = new EventSource(`/jobs/${jobId}/events`);
  source.onmessage = (event) => {
    applyJob(JSON.parse(event.data));
  };
  source.onerror = () => {
    source.close();
  };
})();
