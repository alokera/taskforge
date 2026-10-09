"use client";

import type { JobRecord } from "@taskforge/core";
import { useEffect, useState } from "react";
import { STATE_STYLES, formatDuration, jobDuration } from "@/lib/format";

interface Props {
  jobId: string;
  /** Changes on every poll so the panel refreshes along with the table. */
  refreshKey: number;
  onClose: () => void;
  onChanged: () => void;
}

export function JobDetail({ jobId, refreshKey, onClose, onChanged }: Props) {
  const [job, setJob] = useState<JobRecord | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/jobs/${jobId}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        setNotFound(false);
        setJob(await res.json());
        setFetchedAt(Date.now());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [jobId, refreshKey]);

  async function act(method: "POST" | "DELETE", path: string) {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(path, { method });
      if (!res.ok) throw new Error((await res.json()).error ?? "Action failed");
      onChanged();
      if (method === "DELETE") onClose();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="flex h-full flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <h2 className="font-semibold">
          Job <span className="font-mono">#{jobId}</span>
        </h2>
        <button type="button" onClick={onClose} className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100" aria-label="Close">
          ✕
        </button>
      </div>

      {notFound && <p className="p-4 text-sm text-neutral-500">This job no longer exists (removed, or trimmed from history).</p>}

      {job && !notFound && (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-medium">{job.name}</span>
            <span className={STATE_STYLES[job.state].text}>{STATE_STYLES[job.state].label}</span>
            <span className="text-neutral-500">
              attempts {job.attemptsMade}/{job.opts.attempts ?? 1}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <Field label="Created" value={new Date(job.createdAt).toLocaleString()} />
            {job.runAt && <Field label="Runs at" value={new Date(job.runAt).toLocaleString()} />}
            {job.processedAt && <Field label="Started" value={new Date(job.processedAt).toLocaleString()} />}
            {job.finishedAt && <Field label="Finished" value={new Date(job.finishedAt).toLocaleString()} />}
            <Field label="Duration" value={formatDuration(jobDuration(job, fetchedAt))} />
            {job.opts.backoff && <Field label="Backoff" value={`${job.opts.backoff.type}, ${job.opts.backoff.delay}ms`} />}
          </dl>

          <Section title="Data" value={job.data} />
          {job.returnValue !== undefined && <Section title="Return value" value={job.returnValue} />}
          {job.failedReason && (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {job.state === "failed" ? "Error" : "Last error"}
              </h3>
              <p className="mb-2 text-rose-600 dark:text-rose-400">{job.failedReason}</p>
              {job.stacktrace && (
                <pre className="max-h-48 overflow-auto rounded-lg bg-neutral-100 p-3 text-xs dark:bg-neutral-900">{job.stacktrace}</pre>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            {job.state === "failed" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => act("POST", `/api/jobs/${job.id}/retry`)}
                className="rounded-lg bg-neutral-900 px-3 py-1.5 font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
              >
                Retry
              </button>
            )}
            {job.state !== "active" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => act("DELETE", `/api/jobs/${job.id}`)}
                className="rounded-lg border border-rose-300 px-3 py-1.5 font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:hover:bg-rose-950"
              >
                Remove
              </button>
            )}
          </div>
          {actionError && <p className="text-rose-600">{actionError}</p>}
        </div>
      )}
    </aside>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </>
  );
}

function Section({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h3>
      <pre className="overflow-auto rounded-lg bg-neutral-100 p-3 text-xs dark:bg-neutral-900">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}
