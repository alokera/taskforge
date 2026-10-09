import { Worker } from "@taskforge/core";
import { processJob } from "./processors";

const queueName = process.env.QUEUE_NAME ?? "demo";
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 5);

const worker = new Worker(queueName, processJob, { connection: process.env.REDIS_URL, concurrency });

const time = () => new Date().toLocaleTimeString();
worker.on("completed", (job) => console.log(`${time()} ✅ ${job.name}#${job.id} completed`));
worker.on("failed", (job, error, willRetry) =>
  console.log(`${time()} ${willRetry ? "🔁" : "❌"} ${job.name}#${job.id} failed (attempt ${job.attemptsMade}): ${error.message}`),
);
worker.on("error", (error) => console.error(`${time()} ⚠️  worker error:`, error.message));

console.log(`Worker listening on queue "${queueName}" with concurrency ${concurrency}. Ctrl+C to stop.`);

// Graceful shutdown: stop taking new jobs, let in-flight ones finish, then exit.
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received, finishing in-flight jobs…`);
    await worker.close();
    console.log("Worker stopped cleanly.");
    process.exit(0);
  });
}
