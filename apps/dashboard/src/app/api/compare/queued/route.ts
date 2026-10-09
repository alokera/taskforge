import { WELCOME_EMAIL_JOB_OPTIONS } from "@taskforge/demo-jobs";
import { getQueue } from "@/lib/queue";
import { readEmail } from "@/lib/read-email";

/**
 * "With a queue": the signup request only records a job (a few ms) and returns.
 * A worker sends the email in the background and retries with backoff on failure.
 */
export async function POST(request: Request) {
  const to = await readEmail(request);
  const jobId = await getQueue().add("welcome-email", { to }, WELCOME_EMAIL_JOB_OPTIONS);
  return Response.json({ ok: true, jobId });
}
