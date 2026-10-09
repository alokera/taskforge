import { makeDemoJob } from "@/lib/demo";
import { getQueue } from "@/lib/queue";

const MAX_JOBS = 100;

/** Enqueues a batch of random demo jobs. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const count = Math.min(MAX_JOBS, Math.max(1, Number(body.count) || 10));

  const queue = getQueue();
  const ids = await Promise.all(
    Array.from({ length: count }, () => {
      const job = makeDemoJob();
      return queue.add(job.name, job.data, job.opts);
    }),
  );
  return Response.json({ added: ids.length, ids });
}
