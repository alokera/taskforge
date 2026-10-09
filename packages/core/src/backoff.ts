import type { BackoffOptions } from "./types";

/**
 * Milliseconds to wait before the next attempt.
 * `attemptsMade` counts finished attempts, so it is 1 after the first failure.
 *   fixed:       delay, delay, delay, …
 *   exponential: delay, 2·delay, 4·delay, …
 */
export function computeBackoff(backoff: BackoffOptions | undefined, attemptsMade: number): number {
  if (!backoff) return 0;
  if (backoff.type === "fixed") return backoff.delay;
  return backoff.delay * 2 ** Math.max(0, attemptsMade - 1);
}
