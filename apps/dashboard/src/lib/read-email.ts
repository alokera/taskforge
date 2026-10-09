export async function readEmail(request: Request): Promise<string> {
  const body = await request.json().catch(() => ({}));
  return typeof body.email === "string" && body.email ? body.email.slice(0, 100) : "user@example.com";
}
