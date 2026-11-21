import type { JsonObject } from "type-fest";

export type LogLevel = "debug" | "info" | "warn" | "error";

// Standard output carries logs only. The agent talks over HTTP.
export function log(
  level: LogLevel,
  scope: string,
  message: string,
  fields: JsonObject = {},
): void {
  const record: JsonObject = {
    ...fields,
    time: new Date().toISOString(),
    level,
    scope,
    message,
  };
  process.stdout.write(`${JSON.stringify(record)}\n`);
}
