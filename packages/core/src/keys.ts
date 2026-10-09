/**
 * Redis key layout for one queue. The queue name is wrapped in `{}` (a hash tag)
 * so every key of a queue lands on the same Redis Cluster slot, which is required
 * for the multi-key Lua scripts.
 *
 *   <prefix>:{<queue>}:id         counter for job ids
 *   <prefix>:{<queue>}:job:<id>   hash with the job's fields
 *   <prefix>:{<queue>}:waiting    list  (LPUSH in, worker pops from the right → FIFO)
 *   <prefix>:{<queue>}:active     list  of jobs currently being processed
 *   <prefix>:{<queue>}:delayed    zset  scored by the time the job becomes runnable
 *   <prefix>:{<queue>}:completed  zset  scored by finish time
 *   <prefix>:{<queue>}:failed     zset  scored by finish time
 */
export function queueKeys(prefix: string, queue: string) {
  const base = `${prefix}:{${queue}}`;
  return {
    base,
    id: `${base}:id`,
    jobPrefix: `${base}:job:`,
    job: (id: string) => `${base}:job:${id}`,
    waiting: `${base}:waiting`,
    active: `${base}:active`,
    delayed: `${base}:delayed`,
    completed: `${base}:completed`,
    failed: `${base}:failed`,
  };
}

export type QueueKeys = ReturnType<typeof queueKeys>;
