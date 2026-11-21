import type { JsonObject, JsonValue } from "type-fest";

import type { Config } from "../config/schema.ts";
import type { EventKindDescriptor, ToolDescriptor } from "./descriptors.ts";
import type { EventOccurrence } from "./events.ts";

// The Minecraft server the bot joins, and as whom.
export type Target = {
  host: string;
  port: number;
  username: string;
  auth: "offline" | "microsoft";
  // Detected from the server when null.
  version: string | null;
  // Follows the DNS SRV record `_minecraft._tcp.<host>` to find the real address.
  // When false, the bot connects straight to `host` and `port`.
  resolveSrv: boolean;
};

export type GatewayToCore =
  // `rejoin` is the server the core before this one was meant to be in.
  | { type: "init"; config: Config; rejoin: Target | null }
  | { type: "ping" }
  | { type: "call"; id: number; tool: string; input: unknown };

export type CoreToGateway =
  | { type: "ready"; tools: Array<ToolDescriptor>; eventKinds: Array<EventKindDescriptor> }
  | { type: "pong" }
  | { type: "result"; id: number; result: CallResult }
  | { type: "event"; event: EventOccurrence }
  // The server the bot is meant to be in changed. The gateway keeps it for the next core.
  | { type: "target"; target: Target | null };

export type CallResult = { ok: true; output: JsonValue } | { ok: false; error: CallError };

export interface CallError {
  code: CallErrorCode;
  message: string;
  // Facts the agent can act on, such as the ID of the action that holds the body.
  details?: JsonObject;
}

export type CallErrorCode =
  | "unknown_tool"
  | "invalid_input"
  | "not_connected"
  | "failed"
  | "busy"
  | "interrupted"
  | "unknown_action"
  | "core_unavailable";
