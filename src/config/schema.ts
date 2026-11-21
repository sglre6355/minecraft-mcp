import { z } from "zod";

const minecraft = z.strictObject({
  host: z.string().min(1),
  port: z.int().min(1).max(65_535).default(25_565),
  username: z.string().min(1),
  auth: z.enum(["offline", "microsoft"]).default("microsoft"),
  // Detected from the server when omitted.
  version: z.string().min(1).optional(),
  profilesDirectory: z.string().min(1).optional(),
  // Follows the DNS SRV record `_minecraft._tcp.<host>` to find the real address.
  // When false, the bot connects straight to `host` and `port`.
  resolveSrv: z.boolean().default(true),
});

const server = z.strictObject({
  host: z.string().min(1).default("127.0.0.1"),
  port: z.int().min(0).max(65_535).default(3000),
});

const events = z.strictObject({
  // Events kept per kind.
  capacity: z.int().min(1).default(256),
});

export const configSchema = z.strictObject({
  minecraft,
  server: server.prefault({}),
  events: events.prefault({}),
  plugins: z.array(z.string().min(1)).default([]),
});

export type Config = z.infer<typeof configSchema>;

// The characters an `Authorization: Bearer` header can carry (RFC 6750).
export const tokenSchema = z.string().regex(/^[\w\-.~+/]+=*$/);
