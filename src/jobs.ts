export type JobType = "import" | "autotag";
export type JobStatus = "running" | "done" | "error";

export interface JobLogEntry {
  at: string;
  message: string;
}

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: { current: number; total: number };
  log: JobLogEntry[];
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface JobReport {
  (patch: { current?: number; total?: number; message?: string }): void;
}

const MAX_HISTORY = 20;
const jobs = new Map<string, Job>();

function pruneHistory(): void {
  if (jobs.size <= MAX_HISTORY) return;
  const finished = [...jobs.values()]
    .filter((j) => j.status !== "running")
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  while (jobs.size > MAX_HISTORY && finished.length > 0) {
    jobs.delete(finished.shift()!.id);
  }
}

export function createJob(type: JobType, work: (report: JobReport) => Promise<void>): Job {
  const job: Job = {
    id: crypto.randomUUID(),
    type,
    status: "running",
    progress: { current: 0, total: 0 },
    log: [],
    startedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  pruneHistory();

  const report: JobReport = (patch) => {
    if (patch.current != null) job.progress.current = patch.current;
    if (patch.total != null) job.progress.total = patch.total;
    if (patch.message != null) job.log.push({ at: new Date().toISOString(), message: patch.message });
  };

  work(report)
    .then(() => {
      job.status = "done";
      job.finishedAt = new Date().toISOString();
    })
    .catch((err) => {
      job.status = "error";
      job.error = err instanceof Error ? err.message : String(err);
      job.log.push({ at: new Date().toISOString(), message: `error: ${job.error}` });
      job.finishedAt = new Date().toISOString();
    });

  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
