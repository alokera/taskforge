"use client";

import type { JobCounts, JobRecord, JobState } from "@taskforge/core";
import { useCallback, useEffect, useState } from "react";
import { JobDetail } from "@/components/JobDetail";
import { JobTable } from "@/components/JobTable";
import { StateTabs } from "@/components/StateTabs";

const POLL_INTERVAL_MS = 1000;

interface Overview {
  queue: string;
  counts: JobCounts;
  jobs: JobRecord[];
  page: number;
  pageSize: number;
}

export default function Dashboard() {
  const [state, setState] = useState<JobState>("waiting");
  const [page, setPage] = useState(0);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // Set from the poll response, never during render (render must be deterministic for prerendering).
  const [now, setNow] = useState(0);
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // Polling keeps v0.1 simple; v0.2 replaces it with server-sent events from Redis pub/sub.
  useEffect(() => {
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/overview?state=${state}&page=${page}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load queue");
        if (!cancelled) {
          setOverview(data);
          setError(null);
          setNow(Date.now());
        }
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load queue"));
    return () => {
      cancelled = true;
    };
  }, [state, page, tick]);

  async function addDemoJobs(count: number) {
    setAdding(true);
    try {
      await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count }),
      });
      refresh();
    } finally {
      setAdding(false);
    }
  }

  function selectState(next: JobState) {
    setState(next);
    setPage(0);
  }

  const total = overview?.counts[state] ?? 0;
  const pageSize = overview?.pageSize ?? 25;
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-900 font-bold text-white dark:bg-neutral-100 dark:text-neutral-900">
          T
        </span>
        <div>
          <h1 className="text-xl font-semibold">TaskForge</h1>
          <p className="text-xs text-neutral-500">
            Queue <span className="font-mono">{overview?.queue ?? "…"}</span> · refreshes every second
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            disabled={adding}
            onClick={() => addDemoJobs(10)}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            + 10 demo jobs
          </button>
          <button
            type="button"
            disabled={adding}
            onClick={() => addDemoJobs(100)}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            + 100
          </button>
        </div>
      </header>

      {error && (
        <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}. Is Redis running? (<code>docker compose up -d</code>)
        </p>
      )}

      <StateTabs counts={overview?.counts ?? null} selected={state} onSelect={selectState} />

      <div className={`grid min-h-0 flex-1 gap-4 ${selectedId ? "lg:grid-cols-[1fr_380px]" : ""}`}>
        <section className="min-w-0 rounded-xl border border-neutral-200 dark:border-neutral-800">
          <JobTable state={state} jobs={overview?.jobs ?? []} now={now} selectedId={selectedId} onSelect={setSelectedId} />
          {total > pageSize && (
            <div className="flex items-center justify-between border-t border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800">
              <span className="text-neutral-500">
                {page * pageSize + 1}–{Math.min(total, (page + 1) * pageSize)} of {total.toLocaleString()}
              </span>
              <div className="flex gap-2">
                <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded px-2 py-1 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-900">
                  ← Prev
                </button>
                <button type="button" disabled={page >= lastPage} onClick={() => setPage(page + 1)} className="rounded px-2 py-1 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-900">
                  Next →
                </button>
              </div>
            </div>
          )}
        </section>

        {selectedId && (
          <JobDetail key={selectedId} jobId={selectedId} refreshKey={tick} onClose={() => setSelectedId(null)} onChanged={refresh} />
        )}
      </div>
    </div>
  );
}
