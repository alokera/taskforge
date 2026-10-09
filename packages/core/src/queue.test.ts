// Integration tests against a real Redis (REDIS_URL, default redis://localhost:6379).
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Queue } from "./queue";
import { Worker } from "./worker";

const PREFIX = "tftest";
const cleanups: (() => Promise<void>)[] = [];

function setup<Data = unknown>() {
  const name = `q-${randomUUID()}`;
  const queue = new Queue<Data>(name, { prefix: PREFIX });
  cleanups.push(async () => {
    await queue.obliterate();
    await queue.close();
  });
  const startWorker = (processor: ConstructorParameters<typeof Worker<Data>>[1], options: ConstructorParameters<typeof Worker>[2] = {}) => {
    const worker = new Worker<Data>(name, processor, { prefix: PREFIX, delayedPollInterval: 50, ...options });
    cleanups.unshift(() => worker.close()); // close workers before the queue is wiped
    return worker;
  };
  return { queue, startWorker };
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function waitFor(condition: () => Promise<boolean> | boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Queue", () => {
  it("adds a job in the waiting state", async () => {
    const { queue } = setup<{ to: string }>();
    const id = await queue.add("email", { to: "a@example.com" });

    const job = await queue.getJob(id);
    expect(job).toMatchObject({ id, name: "email", data: { to: "a@example.com" }, state: "waiting", attemptsMade: 0 });
    expect(await queue.getCounts()).toMatchObject({ waiting: 1, active: 0 });
  });

  it("assigns increasing ids and lists waiting jobs newest first", async () => {
    const { queue } = setup();
    const ids = [await queue.add("a", 1), await queue.add("b", 2), await queue.add("c", 3)];
    expect(ids.map(Number)).toEqual([1, 2, 3]);
    expect((await queue.getJobs("waiting")).map((j) => j.name)).toEqual(["c", "b", "a"]);
  });

  it("rejects invalid attempts", async () => {
    const { queue } = setup();
    await expect(queue.add("x", null, { attempts: 0 })).rejects.toThrow();
  });

  it("removes a waiting job", async () => {
    const { queue } = setup();
    const id = await queue.add("x", null);
    expect(await queue.removeJob(id)).toBe(true);
    expect(await queue.getJob(id)).toBeNull();
    expect((await queue.getCounts()).waiting).toBe(0);
    expect(await queue.removeJob(id)).toBe(false);
  });
});

describe("Worker", () => {
  it("processes jobs in FIFO order and stores the return value", async () => {
    const { queue, startWorker } = setup<number>();
    const seen: number[] = [];
    for (const n of [1, 2, 3]) await queue.add("square", n);

    startWorker(async (job) => {
      seen.push(job.data);
      return job.data * job.data;
    });

    await waitFor(async () => (await queue.getCounts()).completed === 3);
    expect(seen).toEqual([1, 2, 3]);
    const [latest] = await queue.getJobs("completed", 0, 0);
    expect(latest).toMatchObject({ state: "completed", returnValue: 9, attemptsMade: 1, progress: 100 });
    expect(latest.finishedAt).toBeGreaterThanOrEqual(latest.processedAt!);
  });

  it("retries with backoff, then succeeds", async () => {
    const { queue, startWorker } = setup();
    const attemptTimes: number[] = [];
    const id = await queue.add("flaky", null, { attempts: 3, backoff: { type: "fixed", delay: 200 } });

    startWorker(async () => {
      attemptTimes.push(Date.now());
      if (attemptTimes.length < 3) throw new Error(`boom ${attemptTimes.length}`);
      return "ok";
    });

    await waitFor(async () => (await queue.getJob(id))?.state === "completed");
    const job = await queue.getJob(id);
    expect(job).toMatchObject({ attemptsMade: 3, returnValue: "ok" });
    expect(attemptTimes[1] - attemptTimes[0]).toBeGreaterThanOrEqual(190);
    expect(attemptTimes[2] - attemptTimes[1]).toBeGreaterThanOrEqual(190);
  });

  it("moves a job to failed after exhausting attempts, and can retry it manually", async () => {
    const { queue, startWorker } = setup();
    const id = await queue.add("doomed", null, { attempts: 2 });
    let shouldFail = true;
    const failures: boolean[] = [];

    const worker = startWorker(async () => {
      if (shouldFail) throw new Error("always fails");
      return "recovered";
    });
    worker.on("failed", (_job, _err, willRetry) => failures.push(willRetry));

    await waitFor(async () => (await queue.getJob(id))?.state === "failed");
    expect(failures).toEqual([true, false]);
    const failed = await queue.getJob(id);
    expect(failed).toMatchObject({ attemptsMade: 2, failedReason: "always fails" });
    expect(failed?.stacktrace).toContain("always fails");

    shouldFail = false;
    expect(await queue.retryJob(id)).toBe(true);
    await waitFor(async () => (await queue.getJob(id))?.state === "completed");
    expect(await queue.getJob(id)).toMatchObject({ returnValue: "recovered", failedReason: undefined });
    expect(await queue.retryJob(id)).toBe(false); // no longer in failed
  });

  it("does not run delayed jobs before their delay", async () => {
    const { queue, startWorker } = setup();
    const addedAt = Date.now();
    const id = await queue.add("later", null, { delay: 300 });
    const delayed = await queue.getJob(id);
    expect(delayed?.state).toBe("delayed");
    expect(delayed?.runAt).toBeGreaterThanOrEqual(addedAt + 300);
    expect((await queue.getJobs("delayed"))[0].runAt).toBe(delayed?.runAt);

    let startedAt = 0;
    startWorker(async () => {
      startedAt = Date.now();
    });

    await waitFor(async () => (await queue.getJob(id))?.state === "completed");
    expect(startedAt - addedAt).toBeGreaterThanOrEqual(300);
  });

  it("runs up to `concurrency` jobs in parallel", async () => {
    const { queue, startWorker } = setup();
    for (let i = 0; i < 10; i++) await queue.add("slow", i);

    let running = 0;
    let maxRunning = 0;
    startWorker(
      async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await sleep(100);
        running--;
      },
      { concurrency: 4 },
    );

    await waitFor(async () => (await queue.getCounts()).completed === 10);
    expect(maxRunning).toBe(4);
  });

  it("delivers each job to exactly one of several competing workers", async () => {
    const { queue, startWorker } = setup<number>();
    const total = 60;
    for (let i = 0; i < total; i++) await queue.add("job", i);

    const processed: number[] = [];
    const processor = async (job: { data: number }) => {
      processed.push(job.data);
      await sleep(5);
    };
    for (let w = 0; w < 3; w++) startWorker(processor, { concurrency: 3 });

    await waitFor(async () => (await queue.getCounts()).completed === total);
    expect(processed).toHaveLength(total);
    expect(new Set(processed).size).toBe(total);
  });

  it("reports progress while a job is active", async () => {
    const { queue, startWorker } = setup();
    const id = await queue.add("report", null);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    startWorker(async (job) => {
      await job.updateProgress(42);
      await gate;
    });

    await waitFor(async () => (await queue.getJob(id))?.progress === 42);
    expect((await queue.getJob(id))?.state).toBe("active");
    await expect(queue.removeJob(id)).rejects.toThrow(/active/);
    release();
    await waitFor(async () => (await queue.getJob(id))?.state === "completed");
  });

  it("keeps only the most recent completed jobs", async () => {
    const { queue, startWorker } = setup();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await queue.add("x", i));

    startWorker(async () => {}, { keepCompleted: 2 });

    await waitFor(async () => (await queue.getCounts()).waiting === 0 && (await queue.getCounts()).active === 0);
    expect((await queue.getCounts()).completed).toBe(2);
    expect(await queue.getJob(ids[0])).toBeNull(); // trimmed jobs are deleted, not just unlisted
    expect((await queue.getJobs("completed")).map((j) => j.id)).toEqual([ids[4], ids[3]]);
  });

  it("finishes in-flight jobs before close() resolves", async () => {
    const { queue, startWorker } = setup();
    const id = await queue.add("long", null);
    const worker = startWorker(async () => {
      await sleep(300);
      return "done";
    });

    await waitFor(async () => (await queue.getJob(id))?.state === "active");
    await worker.close();
    expect((await queue.getJob(id))?.state).toBe("completed");
  });
});
