import { Redis } from "ioredis";
import { createClient } from "./connection";
import { parseJob } from "./job";
import { queueKeys, type QueueKeys } from "./keys";
import { defineScripts, runScript, scripts } from "./scripts";
import type { JobCounts, JobOptions, JobRecord, JobState, QueueOptions } from "./types";

/** Producer and inspection API: add jobs, read their state, retry or remove them. */
export class Queue<Data = unknown, Result = unknown> {
  readonly name: string;
  private readonly keys: QueueKeys;
  private readonly client: Redis;
  private readonly ownsClient: boolean;

  constructor(name: string, options: QueueOptions = {}) {
    this.name = name;
    this.keys = queueKeys(options.prefix ?? "tf", name);
    if (options.connection instanceof Redis) {
      this.client = options.connection;
      defineScripts(this.client);
      this.ownsClient = false;
    } else {
      this.client = createClient(options.connection);
      this.ownsClient = true;
    }
  }

  async add(name: string, data: Data, opts: JobOptions = {}): Promise<string> {
    const attempts = opts.attempts ?? 1;
    if (!Number.isInteger(attempts) || attempts < 1) throw new Error("attempts must be a positive integer");
    return runScript<string>(
      this.client,
      scripts.addJob,
      [this.keys.id, this.keys.waiting, this.keys.delayed],
      [this.keys.jobPrefix, name, JSON.stringify(data ?? null), JSON.stringify({ ...opts, attempts }), Date.now(), opts.delay ?? 0],
    );
  }

  async getJob(id: string): Promise<JobRecord<Data, Result> | null> {
    const [hash, runAt] = await Promise.all([this.client.hgetall(this.keys.job(id)), this.client.zscore(this.keys.delayed, id)]);
    const job = parseJob<Data, Result>(hash);
    if (job && job.state === "delayed" && runAt !== null) job.runAt = Number(runAt);
    return job;
  }

  async getCounts(): Promise<JobCounts> {
    const results = await this.client
      .multi()
      .llen(this.keys.waiting)
      .llen(this.keys.active)
      .zcard(this.keys.delayed)
      .zcard(this.keys.completed)
      .zcard(this.keys.failed)
      .exec();
    const [waiting, active, delayed, completed, failed] = (results ?? []).map(([, value]) => Number(value ?? 0));
    return { waiting, active, delayed, completed, failed };
  }

  /**
   * Lists jobs in a state, most relevant first: newest for waiting/active/completed/failed,
   * soonest-to-run for delayed. `start`/`end` are inclusive offsets, like LRANGE.
   */
  async getJobs(state: JobState, start = 0, end = 49): Promise<JobRecord<Data, Result>[]> {
    let ids: string[];
    const runAts = new Map<string, number>();
    switch (state) {
      case "waiting":
        ids = await this.client.lrange(this.keys.waiting, start, end);
        break;
      case "active":
        ids = await this.client.lrange(this.keys.active, start, end);
        break;
      case "delayed": {
        // Scores are the run-at timestamps, so fetch them too.
        const withScores = await this.client.zrange(this.keys.delayed, start, String(end), "WITHSCORES");
        ids = [];
        for (let i = 0; i < withScores.length; i += 2) {
          ids.push(withScores[i]);
          runAts.set(withScores[i], Number(withScores[i + 1]));
        }
        break;
      }
      case "completed":
        ids = await this.client.zrevrange(this.keys.completed, start, end);
        break;
      case "failed":
        ids = await this.client.zrevrange(this.keys.failed, start, end);
        break;
    }
    if (ids.length === 0) return [];

    const pipeline = this.client.pipeline();
    for (const id of ids) pipeline.hgetall(this.keys.job(id));
    const hashes = (await pipeline.exec()) ?? [];
    return hashes
      .map(([, hash]) => parseJob<Data, Result>(hash as Record<string, string>))
      .filter((job): job is JobRecord<Data, Result> => job !== null)
      .map((job) => (runAts.has(job.id) ? { ...job, runAt: runAts.get(job.id) } : job));
  }

  /** Re-queues a failed job with a fresh attempt budget. Returns false if it isn't in the failed set. */
  async retryJob(id: string): Promise<boolean> {
    const result = await runScript<number>(this.client, scripts.retryJob, [this.keys.failed, this.keys.waiting], [this.keys.jobPrefix, id]);
    return result === 1;
  }

  /** Deletes a job. Active jobs can't be removed because a worker is processing them. */
  async removeJob(id: string): Promise<boolean> {
    const result = await runScript<number>(
      this.client,
      scripts.removeJob,
      [this.keys.waiting, this.keys.delayed, this.keys.completed, this.keys.failed],
      [this.keys.jobPrefix, id],
    );
    if (result === -1) throw new Error(`Job ${id} is active and can't be removed`);
    return result === 1;
  }

  /** Deletes every key of this queue. Intended for tests and local resets. */
  async obliterate(): Promise<void> {
    let cursor = "0";
    do {
      const [next, keys] = await this.client.scan(cursor, "MATCH", `${this.keys.base}:*`, "COUNT", 500);
      if (keys.length) await this.client.del(...keys);
      cursor = next;
    } while (cursor !== "0");
  }

  async close(): Promise<void> {
    if (this.ownsClient) await this.client.quit();
  }
}

