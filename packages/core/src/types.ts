import type { Redis, RedisOptions } from "ioredis";

export type JobState = "waiting" | "active" | "delayed" | "completed" | "failed";

export const JOB_STATES: readonly JobState[] = ["waiting", "active", "delayed", "completed", "failed"];

export type BackoffOptions = { type: "fixed" | "exponential"; delay: number };

export interface JobOptions {
  /** Total attempts including the first one. Default 1 (no retries). */
  attempts?: number;
  /** Delay between retries. Without it, failed jobs are retried immediately. */
  backoff?: BackoffOptions;
  /** Milliseconds to wait before the job becomes available to workers. */
  delay?: number;
}

/** A job as stored in Redis. */
export interface JobRecord<Data = unknown, Result = unknown> {
  id: string;
  name: string;
  data: Data;
  opts: JobOptions;
  state: JobState;
  /** Number of attempts that have finished (succeeded or failed). */
  attemptsMade: number;
  progress: number;
  createdAt: number;
  processedAt?: number;
  /** When a delayed job becomes runnable (only set while the job is delayed). */
  runAt?: number;
  finishedAt?: number;
  returnValue?: Result;
  failedReason?: string;
  stacktrace?: string;
}

/** What a processor function receives. */
export interface Job<Data = unknown> {
  id: string;
  name: string;
  data: Data;
  attemptsMade: number;
  /** Reports progress (0–100), visible in the dashboard. */
  updateProgress(progress: number): Promise<void>;
}

export type Processor<Data = unknown, Result = unknown> = (job: Job<Data>) => Promise<Result>;

/** A Redis URL, ioredis options, or an existing client (Queue only; workers need their own connections). */
export type ConnectionOptions = string | RedisOptions;

export interface QueueOptions {
  connection?: ConnectionOptions | Redis;
  /** Key prefix; all keys live under `<prefix>:{<queue>}:`. Default "tf". */
  prefix?: string;
}

export interface WorkerOptions {
  connection?: ConnectionOptions;
  prefix?: string;
  /** Jobs processed in parallel by this worker. Default 1. */
  concurrency?: number;
  /** Completed jobs to keep for inspection; older ones are deleted. Default 1000. */
  keepCompleted?: number;
  /** Failed jobs to keep. Default 5000. */
  keepFailed?: number;
  /** How often delayed jobs are checked and promoted, in ms. Default 1000. */
  delayedPollInterval?: number;
}

export type JobCounts = Record<JobState, number>;
