import { EventEmitter } from "node:events";
import type { Redis } from "ioredis";
import { computeBackoff } from "./backoff";
import { createClient } from "./connection";
import { arrayToHash, parseJob } from "./job";
import { queueKeys, type QueueKeys } from "./keys";
import { runScript, scripts } from "./scripts";
import type { Job, JobRecord, Processor, WorkerOptions } from "./types";

// Short so close() returns quickly; an idle worker re-issues BLMOVE once per second.
const BLOCK_TIMEOUT_SECONDS = 1;
const PROMOTE_BATCH = 100;

interface WorkerEvents<Data, Result> {
  completed: [job: JobRecord<Data, Result>, result: Result];
  failed: [job: JobRecord<Data, Result>, error: Error, willRetry: boolean];
  error: [error: Error];
}

/**
 * Pulls jobs from a queue and runs `processor` on them.
 *
 * Each concurrency slot is a loop with its own Redis connection, because BLMOVE
 * blocks the connection it runs on. BLMOVE atomically moves a job id from
 * `waiting` to `active`, so two workers can never receive the same job.
 */
export class Worker<Data = unknown, Result = unknown> extends EventEmitter<WorkerEvents<Data, Result>> {
  readonly name: string;
  private readonly keys: QueueKeys;
  private readonly client: Redis;
  private readonly loops: Promise<void>[];
  private readonly promoteTimer: NodeJS.Timeout;
  private readonly keepCompleted: number;
  private readonly keepFailed: number;
  private running = true;
  private closing: Promise<void> | null = null;

  constructor(
    name: string,
    private readonly processor: Processor<Data, Result>,
    options: WorkerOptions = {},
  ) {
    super();
    this.name = name;
    this.keys = queueKeys(options.prefix ?? "tf", name);
    this.client = createClient(options.connection);
    this.keepCompleted = options.keepCompleted ?? 1000;
    this.keepFailed = options.keepFailed ?? 5000;

    const concurrency = options.concurrency ?? 1;
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("concurrency must be a positive integer");
    this.loops = Array.from({ length: concurrency }, () => this.runLoop(createClient(options.connection)));

    this.promoteTimer = setInterval(() => void this.promoteDelayed(), options.delayedPollInterval ?? 1000);
    void this.promoteDelayed();
  }

  private async runLoop(blockingClient: Redis): Promise<void> {
    try {
      while (this.running) {
        let id: string | null;
        try {
          id = await blockingClient.blmove(this.keys.waiting, this.keys.active, "RIGHT", "LEFT", BLOCK_TIMEOUT_SECONDS);
        } catch (error) {
          if (!this.running) break;
          this.reportError(error);
          await sleep(1000);
          continue;
        }
        // Even if close() was called meanwhile, a job we already moved to `active` is processed, not dropped.
        if (id) await this.processJob(id).catch((error) => this.reportError(error));
      }
    } finally {
      blockingClient.disconnect();
    }
  }

  private async processJob(id: string): Promise<void> {
    const raw = await runScript<string[] | null>(this.client, scripts.markActive, [this.keys.active], [this.keys.jobPrefix, id, Date.now()]);
    if (!raw) return;
    const record = parseJob<Data, Result>(arrayToHash(raw));
    if (!record) return;

    const job: Job<Data> = {
      id: record.id,
      name: record.name,
      data: record.data,
      attemptsMade: record.attemptsMade,
      updateProgress: async (progress) => {
        const clamped = Math.max(0, Math.min(100, Math.round(progress)));
        await runScript(this.client, scripts.updateProgress, [], [this.keys.job(id), clamped]);
      },
    };

    let result: Result;
    try {
      result = await this.processor(job);
    } catch (thrown) {
      await this.handleFailure(record, toError(thrown));
      return;
    }

    await runScript(
      this.client,
      scripts.completeJob,
      [this.keys.active, this.keys.completed],
      [this.keys.jobPrefix, id, JSON.stringify(result ?? null), Date.now(), this.keepCompleted],
    );
    this.emit("completed", record, result);
  }

  private async handleFailure(record: JobRecord<Data, Result>, error: Error): Promise<void> {
    const attemptsMade = record.attemptsMade + 1;
    const outcome = await runScript<string>(
      this.client,
      scripts.failJob,
      [this.keys.active, this.keys.waiting, this.keys.delayed, this.keys.failed],
      [
        this.keys.jobPrefix,
        record.id,
        error.message,
        error.stack ?? "",
        Date.now(),
        record.opts.attempts ?? 1,
        computeBackoff(record.opts.backoff, attemptsMade),
        this.keepFailed,
      ],
    );
    this.emit("failed", { ...record, attemptsMade, failedReason: error.message }, error, outcome === "retry");
  }

  private async promoteDelayed(): Promise<void> {
    try {
      await runScript(this.client, scripts.promoteDelayed, [this.keys.delayed, this.keys.waiting], [this.keys.jobPrefix, Date.now(), PROMOTE_BATCH]);
    } catch (error) {
      if (this.running) this.reportError(error);
    }
  }

  private reportError(error: unknown) {
    // EventEmitter throws on an unhandled 'error' event, which would crash the process.
    if (this.listenerCount("error") > 0) this.emit("error", toError(error));
    else console.error(`[taskforge:${this.name}]`, error);
  }

  /** Stops taking new jobs and resolves once in-flight jobs have finished. */
  close(): Promise<void> {
    this.closing ??= (async () => {
      this.running = false;
      clearInterval(this.promoteTimer);
      await Promise.all(this.loops);
      await this.client.quit();
    })();
    return this.closing;
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
