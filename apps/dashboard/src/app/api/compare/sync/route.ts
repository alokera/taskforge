import { sendWelcomeEmail } from "@taskforge/demo-jobs";
import { readEmail } from "@/lib/read-email";

/**
 * "Without a queue": the signup request sends the email itself. The user waits for
 * the slow provider, and if it fails, the whole signup request fails with it.
 */
export async function POST(request: Request) {
  const to = await readEmail(request);
  try {
    const result = await sendWelcomeEmail(to);
    return Response.json({ ok: true, result });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 502 });
  }
}
