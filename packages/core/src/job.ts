import type { JobRecord, JobState } from "./types";

function parseJson(value: string | undefined): unknown {
  if (value === undefined || value === "") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const optionalNumber = (value: string | undefined) => (value === undefined ? undefined : Number(value));

/** Converts a Redis hash (from HGETALL) into a typed job record. */
export function parseJob<Data = unknown, Result = unknown>(hash: Record<string, string>): JobRecord<Data, Result> | null {
  if (!hash.id) return null;
  return {
    id: hash.id,
    name: hash.name,
    data: parseJson(hash.data) as Data,
    opts: (parseJson(hash.opts) as JobRecord["opts"]) ?? {},
    state: hash.state as JobState,
    attemptsMade: Number(hash.attemptsMade ?? 0),
    progress: Number(hash.progress ?? 0),
    createdAt: Number(hash.createdAt),
    processedAt: optionalNumber(hash.processedAt),
    finishedAt: optionalNumber(hash.finishedAt),
    returnValue: parseJson(hash.returnValue) as Result | undefined,
    failedReason: hash.failedReason,
    stacktrace: hash.stacktrace,
  };
}

/** Lua returns HGETALL as a flat [field, value, field, value, …] array. */
export function arrayToHash(values: string[]): Record<string, string> {
  const hash: Record<string, string> = {};
  for (let i = 0; i < values.length; i += 2) hash[values[i]] = values[i + 1];
  return hash;
}
