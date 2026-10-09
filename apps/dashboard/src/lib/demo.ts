import type { JobOptions } from "@taskforge/core";

interface DemoJob {
  name: string;
  data: unknown;
  opts: JobOptions;
}

const pick = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)];
const users = ["asha", "rohan", "meera", "vikram", "zoya", "kabir"];

// Each type exercises a different queue feature (see apps/worker/src/processors.ts).
const generators: (() => DemoJob)[] = [
  () => ({
    name: "send-email",
    data: { to: `${pick(users)}@example.com`, subject: pick(["Welcome!", "Your invoice", "Password reset"]) },
    opts: { attempts: 3, backoff: { type: "exponential", delay: 1000 } },
  }),
  () => ({
    name: "generate-report",
    data: { reportType: pick(["sales", "inventory", "usage"]), rows: Math.floor(Math.random() * 10_000) },
    opts: { attempts: 1 },
  }),
  () => ({
    name: "resize-image",
    data: { imageUrl: `https://cdn.example.com/${pick(users)}.jpg`, width: pick([320, 640, 1280]) },
    opts: { attempts: 4, backoff: { type: "exponential", delay: 500 } },
  }),
  () => ({
    name: "sync-crm",
    data: { accountId: `acct_${Math.floor(Math.random() * 1000)}` },
    opts: { attempts: 2, backoff: { type: "fixed", delay: 2000 } },
  }),
];

export function makeDemoJob(): DemoJob {
  const job = pick(generators)();
  // Some jobs are scheduled for later to show the delayed state.
  if (Math.random() < 0.15) job.opts.delay = 5000 + Math.floor(Math.random() * 10_000);
  return job;
}
