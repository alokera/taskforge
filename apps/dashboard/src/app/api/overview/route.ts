import { JOB_STATES, type JobState } from "@taskforge/core";
import { getQueue } from "@/lib/queue";

const PAGE_SIZE = 25;

/** Counts for every state plus one page of jobs in the selected state — everything the dashboard polls for. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const state = (params.get("state") ?? "waiting") as JobState;
  if (!JOB_STATES.includes(state)) {
    return Response.json({ error: `Unknown state "${state}"` }, { status: 400 });
  }
  const page = Math.max(0, Number(params.get("page")) || 0);

  const queue = getQueue();
  const start = page * PAGE_SIZE;
  const [counts, jobs] = await Promise.all([queue.getCounts(), queue.getJobs(state, start, start + PAGE_SIZE - 1)]);
  return Response.json({ queue: queue.name, counts, jobs, state, page, pageSize: PAGE_SIZE });
}
