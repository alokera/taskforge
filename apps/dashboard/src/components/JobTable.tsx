import type { JobRecord, JobState } from "@taskforge/core";
import { formatDuration, jobDuration, timeAgo } from "@/lib/format";

interface Props {
  state: JobState;
  jobs: JobRecord[];
  now: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function JobTable({ state, jobs, now, selectedId, onSelect }: Props) {
  if (jobs.length === 0) {
    return <p className="py-16 text-center text-sm text-neutral-500">No {state} jobs.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-neutral-500">
          <tr className="border-b border-neutral-200 dark:border-neutral-800">
            <th className="px-3 py-2 font-medium">ID</th>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Attempts</th>
            <th className="px-3 py-2 font-medium">{state === "delayed" ? "Runs" : "Created"}</th>
            <th className="px-3 py-2 font-medium">{state === "active" ? "Progress" : "Duration"}</th>
            {state === "failed" && <th className="px-3 py-2 font-medium">Error</th>}
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr
              key={job.id}
              onClick={() => onSelect(job.id)}
              className={`cursor-pointer border-b border-neutral-100 hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900 ${
                selectedId === job.id ? "bg-neutral-100 dark:bg-neutral-900" : ""
              }`}
            >
              <td className="px-3 py-2 font-mono text-neutral-500">#{job.id}</td>
              <td className="px-3 py-2 font-medium">{job.name}</td>
              <td className="px-3 py-2 tabular-nums">
                {job.attemptsMade}/{job.opts.attempts ?? 1}
              </td>
              <td className="px-3 py-2 text-neutral-500">
                {state === "delayed" ? timeAgo(job.runAt, now) : timeAgo(job.createdAt, now)}
              </td>
              <td className="px-3 py-2">
                {state === "active" ? <ProgressBar value={job.progress} /> : <span className="tabular-nums">{formatDuration(jobDuration(job, now))}</span>}
              </td>
              {state === "failed" && <td className="max-w-xs truncate px-3 py-2 text-rose-600 dark:text-rose-400">{job.failedReason}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div className="h-full bg-amber-500 transition-all" style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs tabular-nums text-neutral-500">{value}%</span>
    </div>
  );
}
