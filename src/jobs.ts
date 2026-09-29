export type JobType = "import" | "autotag" | "classify";
export type JobStatus = "running" | "done" | "error" | "cancelled";

export interface JobLogEntry {
  at: string;
  message: string;
}

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: { current: number; total: number };
  // Running numeric counters a job wants to surface live (e.g. API quota
  // spent, tokens used) - keyed loosely so each job type can report whatever
  // is relevant to it without changing this shape.
  meta: Record<string, number>;
  log: JobLogEntry[];
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface JobReport {
  (patch: { current?: number; total?: number; message?: string; metaDelta?: Record<string, number> }): void;
}

const MAX_HISTORY = 20;
const jobs = new Map<string, Job>();
// Kept out of the Job object itself so it never ends up in the JSON snapshot
// the SSE stream serializes and sends to the browser.
const controllers = new Map<string, AbortController>();

function pruneHistory(): void {
  if (jobs.size <= MAX_HISTORY) return;
  const finished = [...jobs.values()]
    .filter((j) => j.status !== "running")
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  while (jobs.size > MAX_HISTORY && finished.length > 0) {
    jobs.delete(finished.shift()!.id);
  }
}

export function createJob(
  type: JobType,
  work: (report: JobReport, signal: AbortSignal) => Promise<void>,
): Job {
  const job: Job = {
    id: crypto.randomUUID(),
    type,
    status: "running",
    progress: { current: 0, total: 0 },
    meta: {},
    log: [],
    startedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  pruneHistory();

  const controller = new AbortController();
  controllers.set(job.id, controller);

  const report: JobReport = (patch) => {
    if (patch.current != null) job.progress.current = patch.current;
    if (patch.total != null) job.progress.total = patch.total;
    if (patch.message != null) job.log.push({ at: new Date().toISOString(), message: patch.message });
    if (patch.metaDelta) {
      for (const [key, delta] of Object.entries(patch.metaDelta)) {
        job.meta[key] = (job.meta[key] ?? 0) + delta;
      }
    }
  };

  work(report, controller.signal)
    .then(() => {
      job.status = controller.signal.aborted ? "cancelled" : "done";
      job.finishedAt = new Date().toISOString();
    })
    .catch((err) => {
      if (controller.signal.aborted) {
        job.status = "cancelled";
        job.log.push({ at: new Date().toISOString(), message: "cancelled" });
      } else {
        job.status = "error";
        job.error = err instanceof Error ? err.message : String(err);
        job.log.push({ at: new Date().toISOString(), message: `error: ${job.error}` });
      }
      job.finishedAt = new Date().toISOString();
    })
    .finally(() => controllers.delete(job.id));

  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

// Signals the job's AbortSignal - it's up to the job's own work function to
// check `signal.aborted` between steps and actually stop. Returns false if
// the job doesn't exist or has already finished.
export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  const controller = controllers.get(id);
  if (!job || !controller || job.status !== "running") return false;
  controller.abort();
  return true;
}
