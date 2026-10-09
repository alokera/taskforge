import { Redis } from "ioredis";
import { defineScripts } from "./scripts";
import type { ConnectionOptions } from "./types";

const DEFAULT_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

/**
 * Creates a client with the queue's Lua scripts registered.
 * `maxRetriesPerRequest: null` is required for blocking commands (BLMOVE), which
 * would otherwise be aborted while the connection is reconnecting.
 */
export function createClient(connection: ConnectionOptions = DEFAULT_URL): Redis {
  const client =
    typeof connection === "string"
      ? new Redis(connection, { maxRetriesPerRequest: null })
      : new Redis({ ...connection, maxRetriesPerRequest: null });
  defineScripts(client);
  return client;
}
