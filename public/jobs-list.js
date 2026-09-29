(() => {
  const list = document.querySelector(".jobs-list");
  if (!list) return;

  function applyJobs(jobs) {
    let anyRunning = false;

    for (const job of jobs) {
      if (job.status === "running") anyRunning = true;

      // A job created after this page loaded (e.g. the classify run an
      // import auto-starts) has no row yet - it shows up on the next visit
      // rather than being spliced into the list live.
      const row = list.querySelector(`[data-job-id="${job.id}"]`);
      if (!row) continue;

      const statusEl = row.querySelector(".job-panel__status");
      statusEl.textContent = job.status;
      statusEl.className = `job-panel__status job-panel__status--${job.status}`;

      const progressEl = row.querySelector(".jobs-list__progress");
      progressEl.textContent = `${job.progress.current}/${job.progress.total || "?"}`;
    }

    if (!anyRunning) source.close();
  }

  const source = new EventSource("/jobs/events");
  source.onmessage = (event) => {
    applyJobs(JSON.parse(event.data));
  };
  source.onerror = () => {
    source.close();
  };
})();
