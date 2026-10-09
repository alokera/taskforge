import type { Redis } from "ioredis";

/**
 * Every state transition is a Lua script. Redis runs a script atomically, so a
 * job can never be seen in two states at once (or none) even with many workers
 * and dashboards hitting the same queue concurrently.
 */
interface Script {
  name: string;
  numberOfKeys: number;
  lua: string;
}

/** Deletes the oldest entries (and their job hashes) of a sorted set beyond `keep`. */
const trimSet = (setKey: string, keepArg: string) => `
local excess = redis.call('ZCARD', ${setKey}) - tonumber(${keepArg})
if excess > 0 then
  local old = redis.call('ZRANGE', ${setKey}, 0, excess - 1)
  for _, oldId in ipairs(old) do redis.call('DEL', jobPrefix .. oldId) end
  redis.call('ZREMRANGEBYRANK', ${setKey}, 0, excess - 1)
end`;

// KEYS: id, waiting, delayed   ARGV: jobPrefix, name, data, opts, now, delay
const addJob: Script = {
  name: "tfAddJob",
  numberOfKeys: 3,
  lua: `
local id = tostring(redis.call('INCR', KEYS[1]))
local delay = tonumber(ARGV[6])
local state = 'waiting'
if delay > 0 then state = 'delayed' end
redis.call('HSET', ARGV[1] .. id, 'id', id, 'name', ARGV[2], 'data', ARGV[3], 'opts', ARGV[4],
  'state', state, 'attemptsMade', 0, 'progress', 0, 'createdAt', ARGV[5])
if delay > 0 then
  redis.call('ZADD', KEYS[3], tonumber(ARGV[5]) + delay, id)
else
  redis.call('LPUSH', KEYS[2], id)
end
return id`,
};

// Runs right after a worker BLMOVEs an id from waiting → active.
// KEYS: active   ARGV: jobPrefix, id, now
const markActive: Script = {
  name: "tfMarkActive",
  numberOfKeys: 1,
  lua: `
local jobKey = ARGV[1] .. ARGV[2]
if redis.call('EXISTS', jobKey) == 0 then
  -- The job was removed while waiting; drop the dangling id.
  redis.call('LREM', KEYS[1], 1, ARGV[2])
  return nil
end
redis.call('HSET', jobKey, 'state', 'active', 'processedAt', ARGV[3], 'progress', 0)
return redis.call('HGETALL', jobKey)`,
};

// KEYS: active, completed   ARGV: jobPrefix, id, returnValue, now, keepCompleted
const completeJob: Script = {
  name: "tfCompleteJob",
  numberOfKeys: 2,
  lua: `
local jobPrefix = ARGV[1]
local jobKey = jobPrefix .. ARGV[2]
if redis.call('LREM', KEYS[1], 1, ARGV[2]) == 0 then return 0 end
redis.call('HINCRBY', jobKey, 'attemptsMade', 1)
redis.call('HSET', jobKey, 'state', 'completed', 'returnValue', ARGV[3], 'finishedAt', ARGV[4], 'progress', 100)
redis.call('ZADD', KEYS[2], ARGV[4], ARGV[2])
${trimSet("KEYS[2]", "ARGV[5]")}
return 1`,
};

// Returns 'retry' if another attempt was scheduled, 'failed' if attempts are exhausted.
// KEYS: active, waiting, delayed, failed   ARGV: jobPrefix, id, reason, stack, now, maxAttempts, backoffDelay, keepFailed
const failJob: Script = {
  name: "tfFailJob",
  numberOfKeys: 4,
  lua: `
local jobPrefix = ARGV[1]
local jobKey = jobPrefix .. ARGV[2]
if redis.call('LREM', KEYS[1], 1, ARGV[2]) == 0 then return 'gone' end
local attempts = redis.call('HINCRBY', jobKey, 'attemptsMade', 1)
redis.call('HSET', jobKey, 'failedReason', ARGV[3], 'stacktrace', ARGV[4])
if attempts < tonumber(ARGV[6]) then
  local delay = tonumber(ARGV[7])
  if delay > 0 then
    redis.call('HSET', jobKey, 'state', 'delayed')
    redis.call('ZADD', KEYS[3], tonumber(ARGV[5]) + delay, ARGV[2])
  else
    redis.call('HSET', jobKey, 'state', 'waiting')
    redis.call('LPUSH', KEYS[2], ARGV[2])
  end
  return 'retry'
end
redis.call('HSET', jobKey, 'state', 'failed', 'finishedAt', ARGV[5])
redis.call('ZADD', KEYS[4], ARGV[5], ARGV[2])
${trimSet("KEYS[4]", "ARGV[8]")}
return 'failed'`,
};

// Moves delayed jobs whose time has come to waiting. Safe to run from many workers at once.
// KEYS: delayed, waiting   ARGV: jobPrefix, now, limit
const promoteDelayed: Script = {
  name: "tfPromoteDelayed",
  numberOfKeys: 2,
  lua: `
local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[2], 'LIMIT', 0, tonumber(ARGV[3]))
for _, id in ipairs(ids) do
  redis.call('ZREM', KEYS[1], id)
  redis.call('HSET', ARGV[1] .. id, 'state', 'waiting')
  redis.call('LPUSH', KEYS[2], id)
end
return #ids`,
};

// KEYS: (none)   ARGV: jobKey, progress
const updateProgress: Script = {
  name: "tfUpdateProgress",
  numberOfKeys: 0,
  lua: `
if redis.call('HGET', ARGV[1], 'state') ~= 'active' then return 0 end
redis.call('HSET', ARGV[1], 'progress', ARGV[2])
return 1`,
};

// Manually re-queues a failed job with a fresh attempt budget.
// KEYS: failed, waiting   ARGV: jobPrefix, id
const retryJob: Script = {
  name: "tfRetryJob",
  numberOfKeys: 2,
  lua: `
local jobKey = ARGV[1] .. ARGV[2]
if redis.call('ZREM', KEYS[1], ARGV[2]) == 0 then return 0 end
redis.call('HSET', jobKey, 'state', 'waiting', 'attemptsMade', 0, 'progress', 0)
redis.call('HDEL', jobKey, 'failedReason', 'stacktrace', 'finishedAt', 'processedAt')
redis.call('LPUSH', KEYS[2], ARGV[2])
return 1`,
};

// Returns 1 if removed, 0 if not found, -1 if the job is active (a worker owns it).
// KEYS: waiting, delayed, completed, failed   ARGV: jobPrefix, id
const removeJob: Script = {
  name: "tfRemoveJob",
  numberOfKeys: 4,
  lua: `
local jobKey = ARGV[1] .. ARGV[2]
local state = redis.call('HGET', jobKey, 'state')
if not state then return 0 end
if state == 'active' then return -1 end
redis.call('LREM', KEYS[1], 0, ARGV[2])
redis.call('ZREM', KEYS[2], ARGV[2])
redis.call('ZREM', KEYS[3], ARGV[2])
redis.call('ZREM', KEYS[4], ARGV[2])
redis.call('DEL', jobKey)
return 1`,
};

export const scripts = {
  addJob,
  markActive,
  completeJob,
  failJob,
  promoteDelayed,
  updateProgress,
  retryJob,
  removeJob,
};

/**
 * Registers all scripts on a client (idempotent, so shared clients are fine).
 * ioredis then runs them via EVALSHA, falling back to EVAL if Redis hasn't cached them.
 */
export function defineScripts(redis: Redis): void {
  for (const script of Object.values(scripts)) {
    if (script.name in redis) continue;
    redis.defineCommand(script.name, { numberOfKeys: script.numberOfKeys, lua: script.lua });
  }
}

export function runScript<T>(redis: Redis, script: Script, keys: string[], args: (string | number)[]): Promise<T> {
  const command = (redis as unknown as Record<string, (...params: (string | number)[]) => Promise<T>>)[script.name];
  return command.call(redis, ...keys, ...args);
}
