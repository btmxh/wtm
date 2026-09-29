(() => {
  const panel = document.querySelector(".job-panel");
  if (!panel) return;

  const jobId = panel.dataset.jobId;
  const statusEl = panel.querySelector(".job-panel__status");
  const barFillEl = panel.querySelector(".job-panel__bar-fill");
  const countEl = panel.querySelector(".job-panel__count");
  const logEl = panel.querySelector(".job-panel__log");

  let renderedLogCount = logEl.children.length;

  function applyJob(job) {
    statusEl.textContent = job.status;
    statusEl.className = `job-panel__status job-panel__status--${job.status}`;

    const pct = job.progress.total > 0 ? Math.round((job.progress.current / job.progress.total) * 100) : 0;
    barFillEl.style.width = `${pct}%`;
    countEl.textContent = `${job.progress.current} / ${job.progress.total || "?"}`;

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
