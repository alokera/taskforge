import type { JobRecord, JobState } from "@taskforge/core";

// Client-safe copy of the states (importing values from @taskforge/core would pull ioredis into the browser bundle).
export const STATES: JobState[] = ["waiting", "active", "delayed", "completed", "failed"];

export const STATE_STYLES: Record<JobState, { label: string; dot: string; text: string }> = {
  waiting: { label: "Waiting", dot: "bg-sky-500", text: "text-sky-600 dark:text-sky-400" },
  active: { label: "Active", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  delayed: { label: "Delayed", dot: "bg-violet-500", text: "text-violet-600 dark:text-violet-400" },
  completed: { label: "Completed", dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  failed: { label: "Failed", dot: "bg-rose-500", text: "text-rose-600 dark:text-rose-400" },
};

export function timeAgo(timestamp: number | undefined, now: number): string {
  if (!timestamp) return "—";
  const seconds = Math.round((now - timestamp) / 1000);
  if (seconds < 0) return `in ${formatDuration(-seconds * 1000)}`;
  if (seconds < 5) return "just now";
  return `${formatDuration(seconds * 1000)} ago`;
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Processing time; for a job still running, measured up to `now`. */
export function jobDuration(job: JobRecord, now: number): number | undefined {
  if (!job.processedAt) return undefined;
  return (job.finishedAt ?? now) - job.processedAt;
}
