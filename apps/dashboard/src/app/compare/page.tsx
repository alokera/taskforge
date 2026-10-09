"use client";

import type { JobRecord } from "@taskforge/core";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/format";

// Must match WELCOME_EMAIL_JOB_OPTIONS / sendWelcomeEmail in packages/demo-jobs.
const SCENARIO = { minMs: 1500, maxMs: 3000, failureRate: 0.4, attempts: 5, backoffMs: 500 };
const POLL_MS = 400;
const GIVE_UP_MS = 60_000;

interface SyncRow {
  id: number;
  email: string;
  startedAt: number;
  finishedAt?: number;
  ok?: boolean;
  error?: string;
}

interface QueuedRow {
  id: number;
  email: string;
  startedAt: number;
  respondedAt?: number;
  jobId?: string;
  error?: string;
  events: { at: number; text: string; tone: "info" | "warn" | "good" | "bad" }[];
  emailDoneAt?: number;
  delivered?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function ComparePage() {
  const [syncRows, setSyncRows] = useState<SyncRow[]>([]);
  const [queuedRows, setQueuedRows] = useState<QueuedRow[]>([]);
  const nextId = useRef(1);
  const now = useNow(syncRows.some((r) => !r.finishedAt) || queuedRows.some((r) => !r.emailDoneAt && !r.error));

  const patchSync = (id: number, patch: Partial<SyncRow>) => setSyncRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const patchQueued = (id: number, update: (row: QueuedRow) => QueuedRow) => setQueuedRows((rows) => rows.map((r) => (r.id === id ? update(r) : r)));

  function newUser() {
    const id = nextId.current++;
    return { id, email: `user${id}@example.com`, startedAt: Date.now() };
  }

  async function signUpWithoutQueue() {
    const row = newUser();
    setSyncRows((rows) => [row, ...rows]);
    try {
      const res = await fetch("/api/compare/sync", { method: "POST", body: JSON.stringify({ email: row.email }) });
      const data = await res.json();
      patchSync(row.id, { finishedAt: Date.now(), ok: res.ok, error: data.error });
    } catch {
      patchSync(row.id, { finishedAt: Date.now(), ok: false, error: "Network error" });
    }
  }

  async function signUpWithQueue() {
    const row: QueuedRow = { ...newUser(), events: [] };
    setQueuedRows((rows) => [row, ...rows]);

    let jobId: string;
    try {
      const res = await fetch("/api/compare/queued", { method: "POST", body: JSON.stringify({ email: row.email }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Enqueue failed");
      jobId = data.jobId;
      const respondedAt = Date.now();
      patchQueued(row.id, (r) => ({ ...r, respondedAt, jobId, events: [{ at: respondedAt, text: "Job queued, waiting for a worker", tone: "info" }] }));
    } catch (error) {
      patchQueued(row.id, (r) => ({ ...r, respondedAt: Date.now(), error: error instanceof Error ? error.message : "Enqueue failed" }));
      return;
    }

    // Follow the job in the background, turning each state change into a timeline event.
    let last = { state: "waiting", attempts: 0 };
    while (Date.now() - row.startedAt < GIVE_UP_MS) {
      await sleep(POLL_MS);
      const res = await fetch(`/api/jobs/${jobId}`).catch(() => null);
      if (!res?.ok) continue;
      const job: JobRecord = await res.json();
      if (job.state === last.state && job.attemptsMade === last.attempts) continue;

      const at = Date.now();
      const event = describe(job, last.attempts);
      last = { state: job.state, attempts: job.attemptsMade };
      const done = job.state === "completed" || job.state === "failed";
      patchQueued(row.id, (r) => ({
        ...r,
        events: event ? [...r.events, { at, ...event }] : r.events,
        ...(done ? { emailDoneAt: at, delivered: job.state === "completed" } : {}),
      }));
      if (done) return;
    }
  }

  const run = (fn: () => Promise<void>, times: number) => {
    for (let i = 0; i < times; i++) void fn();
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <header className="space-y-2">
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
          ← Back to dashboard
        </Link>
        <h1 className="text-2xl font-semibold">Why use a queue?</h1>
        <p className="max-w-3xl text-sm text-neutral-600 dark:text-neutral-400">
          A user signs up and the app sends a welcome email. The email provider is slow (
          {SCENARIO.minMs / 1000}–{SCENARIO.maxMs / 1000}s) and unreliable (fails {SCENARIO.failureRate * 100}% of the time). Both sides
          below call <strong>the exact same</strong> <code className="font-mono">sendWelcomeEmail()</code> function. The only difference is{" "}
          <em>where</em> it runs.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          tone="bad"
          title="Without a queue"
          description="The signup request sends the email itself. The user stares at a spinner until the provider answers, and if the email fails, their signup fails with it."
          code={`// POST /api/signup\nawait createUser(email)\nawait sendWelcomeEmail(email) // user waits\nreturn "Welcome!"`}
          onOne={() => run(signUpWithoutQueue, 1)}
          onFive={() => run(signUpWithoutQueue, 5)}
          onClear={() => setSyncRows([])}
          stats={syncStats(syncRows)}
        >
          {syncRows.map((row) => (
            <SyncRowView key={row.id} row={row} now={now} />
          ))}
        </Panel>

        <Panel
          tone="good"
          title="With a queue (TaskForge)"
          description={`The signup request only adds a job and returns instantly. A worker sends the email in the background and retries failures with exponential backoff (up to ${SCENARIO.attempts} attempts).`}
          code={`// POST /api/signup\nawait createUser(email)\nawait queue.add("welcome-email", { email }) // ~ms\nreturn "Welcome!"`}
          onOne={() => run(signUpWithQueue, 1)}
          onFive={() => run(signUpWithQueue, 5)}
          onClear={() => setQueuedRows([])}
          stats={queuedStats(queuedRows)}
        >
          {queuedRows.map((row) => (
            <QueuedRowView key={row.id} row={row} now={now} />
          ))}
        </Panel>
      </div>

      <p className="text-xs text-neutral-500">
        The queued side needs a worker running: <code className="font-mono">npm run dev:worker</code>. Queued jobs also appear on the main
        dashboard as <code className="font-mono">welcome-email</code>.
      </p>
    </div>
  );
}

/** Re-renders every 100ms while something is in flight, so timers tick. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function describe(job: JobRecord, previousAttempts: number): Omit<QueuedRow["events"][number], "at"> | null {
  const failedNow = job.attemptsMade > previousAttempts && job.failedReason;
  switch (job.state) {
    case "active":
      return { text: `Worker sending email (attempt ${job.attemptsMade + 1})`, tone: "info" };
    case "delayed":
    case "waiting":
      return failedNow
        ? { text: `Attempt ${job.attemptsMade} failed: ${job.failedReason}. Retrying automatically…`, tone: "warn" }
        : null;
    case "completed":
      return { text: `Email delivered${job.attemptsMade > 1 ? ` after ${job.attemptsMade} attempts` : ""} ✓`, tone: "good" };
    case "failed":
      return { text: `Gave up after ${job.attemptsMade} attempts: ${job.failedReason}`, tone: "bad" };
  }
}

function syncStats(rows: SyncRow[]) {
  const done = rows.filter((r) => r.finishedAt);
  const avgWait = done.length ? done.reduce((sum, r) => sum + (r.finishedAt! - r.startedAt), 0) / done.length : undefined;
  return [
    { label: "Avg. time user waits", value: formatDuration(avgWait && Math.round(avgWait)) },
    { label: "Signups that showed an error", value: `${done.filter((r) => !r.ok).length} / ${done.length}`, bad: done.some((r) => !r.ok) },
    { label: "Emails delivered", value: `${done.filter((r) => r.ok).length} / ${rows.length}` },
  ];
}

function queuedStats(rows: QueuedRow[]) {
  const responded = rows.filter((r) => r.respondedAt);
  const avgWait = responded.length ? responded.reduce((sum, r) => sum + (r.respondedAt! - r.startedAt), 0) / responded.length : undefined;
  return [
    { label: "Avg. time user waits", value: formatDuration(avgWait && Math.round(avgWait)) },
    { label: "Signups that showed an error", value: `${responded.filter((r) => r.error).length} / ${responded.length}`, bad: responded.some((r) => r.error) },
    { label: "Emails delivered", value: `${rows.filter((r) => r.delivered).length} / ${rows.length}` },
  ];
}

interface PanelProps {
  tone: "good" | "bad";
  title: string;
  description: string;
  code: string;
  stats: { label: string; value: string; bad?: boolean }[];
  onOne: () => void;
  onFive: () => void;
  onClear: () => void;
  children: React.ReactNode;
}

function Panel({ tone, title, description, code, stats, onOne, onFive, onClear, children }: PanelProps) {
  const accent = tone === "good" ? "border-t-emerald-500" : "border-t-rose-500";
  return (
    <section className={`flex min-h-[32rem] flex-col rounded-xl border border-t-4 border-neutral-200 dark:border-neutral-800 ${accent}`}>
      <div className="space-y-3 border-b border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="text-lg font-semibold">
          {tone === "good" ? "✅" : "❌"} {title}
        </h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{description}</p>
        <pre className="overflow-x-auto rounded-lg bg-neutral-100 p-3 text-xs dark:bg-neutral-900">{code}</pre>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onOne} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300">
            Sign up 1 user
          </button>
          <button type="button" onClick={onFive} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900">
            Sign up 5 at once
          </button>
          <button type="button" onClick={onClear} className="ml-auto px-2 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
            Clear
          </button>
        </div>
        <dl className="grid grid-cols-3 gap-2">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg bg-neutral-50 p-2 dark:bg-neutral-900">
              <dt className="text-[11px] leading-tight text-neutral-500">{s.label}</dt>
              <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${s.bad ? "text-rose-600 dark:text-rose-400" : ""}`}>{s.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">{children}</ul>
    </section>
  );
}

function SyncRowView({ row, now }: { row: SyncRow; now: number }) {
  const waiting = !row.finishedAt;
  const elapsed = (row.finishedAt ?? Math.max(now, row.startedAt)) - row.startedAt;
  return (
    <li className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-neutral-500">{row.email}</span>
        <span className="tabular-nums text-xs text-neutral-500">{formatDuration(elapsed)}</span>
      </div>
      {waiting && <p className="mt-1 animate-pulse text-amber-600 dark:text-amber-400">⏳ User is waiting on a spinner…</p>}
      {row.ok && <p className="mt-1 text-emerald-600 dark:text-emerald-400">Signed up, but only after waiting {formatDuration(elapsed)}</p>}
      {row.finishedAt && !row.ok && (
        <p className="mt-1 text-rose-600 dark:text-rose-400">
          User sees “Something went wrong” after {formatDuration(elapsed)} ({row.error}). Email lost.
        </p>
      )}
    </li>
  );
}

function QueuedRowView({ row, now }: { row: QueuedRow; now: number }) {
  const responseMs = row.respondedAt ? row.respondedAt - row.startedAt : undefined;
  const stuck = row.jobId && row.events.length === 1 && !row.emailDoneAt && now - (row.respondedAt ?? now) > 4000;
  const toneClass = { info: "text-neutral-500", warn: "text-amber-600 dark:text-amber-400", good: "text-emerald-600 dark:text-emerald-400", bad: "text-rose-600 dark:text-rose-400" };
  return (
    <li className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-neutral-500">{row.email}</span>
        {row.jobId && <span className="font-mono text-xs text-neutral-500">job #{row.jobId}</span>}
      </div>
      {!row.respondedAt && <p className="mt-1 text-neutral-500">Sending request…</p>}
      {row.error && <p className="mt-1 text-rose-600 dark:text-rose-400">Could not queue: {row.error}</p>}
      {responseMs !== undefined && !row.error && (
        <p className="mt-1 text-emerald-600 dark:text-emerald-400">Signed up instantly: response in {formatDuration(responseMs)}</p>
      )}
      {row.events.length > 0 && (
        <ol className="mt-2 space-y-0.5 border-l-2 border-neutral-200 pl-3 text-xs dark:border-neutral-800">
          {row.events.map((event, i) => (
            <li key={i} className={toneClass[event.tone]}>
              <span className="tabular-nums text-neutral-400">+{formatDuration(event.at - row.startedAt)}</span> {event.text}
            </li>
          ))}
        </ol>
      )}
      {stuck && <p className="mt-1 text-xs text-amber-600">No worker has picked this up. Is <code>npm run dev:worker</code> running?</p>}
    </li>
  );
}
