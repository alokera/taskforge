import { getQueue } from "@/lib/queue";

export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const job = await getQueue().getJob(id);
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
  return Response.json(job);
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  try {
    const removed = await getQueue().removeJob(id);
    if (!removed) return Response.json({ error: "Job not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    // Active jobs belong to a worker and can't be removed.
    return Response.json({ error: error instanceof Error ? error.message : "Remove failed" }, { status: 409 });
  }
}
