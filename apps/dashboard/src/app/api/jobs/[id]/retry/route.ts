import { getQueue } from "@/lib/queue";

export async function POST(_request: Request, ctx: RouteContext<"/api/jobs/[id]/retry">) {
  const { id } = await ctx.params;
  const retried = await getQueue().retryJob(id);
  if (!retried) return Response.json({ error: "Only failed jobs can be retried" }, { status: 409 });
  return Response.json({ ok: true });
}
