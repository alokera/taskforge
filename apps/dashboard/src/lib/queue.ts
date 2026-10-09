import "server-only";
import { Queue } from "@taskforge/core";

export const QUEUE_NAME = process.env.QUEUE_NAME ?? "demo";

// Reuse one Redis connection across requests (and across hot reloads in dev).
const globalForQueue = globalThis as unknown as { taskforgeQueue?: Queue };

export function getQueue(): Queue {
  globalForQueue.taskforgeQueue ??= new Queue(QUEUE_NAME, { connection: process.env.REDIS_URL });
  return globalForQueue.taskforgeQueue;
}
