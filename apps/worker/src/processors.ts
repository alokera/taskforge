import type { Job } from "@taskforge/core";

// Simulated workloads with realistic timing and failure rates, so the dashboard has
// something interesting to show: retries, backoff, progress, and permanent failures.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const between = (min: number, max: number) => min + Math.random() * (max - min);

async function sendEmail(job: Job<{ to: string; subject: string }>) {
  await sleep(between(200, 800));
  if (Math.random() < 0.15) throw new Error("SMTP server timed out");
  return { messageId: `msg_${job.id}_${Date.now().toString(36)}`, to: job.data.to };
}

async function generateReport(job: Job<{ reportType: string; rows: number }>) {
  for (let step = 1; step <= 10; step++) {
    await sleep(between(150, 400));
    await job.updateProgress(step * 10);
  }
  return { url: `https://reports.example.com/${job.data.reportType}-${job.id}.pdf`, rows: job.data.rows };
}

async function resizeImage(job: Job<{ imageUrl: string; width: number }>) {
  await sleep(between(300, 1000));
  // Flaky dependency: the first attempts often fail, so retries with backoff usually rescue it.
  if (job.attemptsMade < 2 && Math.random() < 0.5) throw new Error("Image CDN returned 503");
  return { resizedUrl: `${job.data.imageUrl}?w=${job.data.width}`, width: job.data.width };
}

async function syncCrm() {
  await sleep(between(500, 1500));
  // Fails permanently, to demonstrate the failed state and manual retry from the dashboard.
  throw new Error("CRM API key revoked (401 Unauthorized)");
}

const processors: Record<string, (job: Job<never>) => Promise<unknown>> = {
  "send-email": sendEmail,
  "generate-report": generateReport,
  "resize-image": resizeImage,
  "sync-crm": syncCrm,
};

export async function processJob(job: Job<unknown>): Promise<unknown> {
  const processor = processors[job.name];
  if (!processor) throw new Error(`No processor registered for job "${job.name}"`);
  return processor(job as Job<never>);
}
