import type { JsonValue } from "type-fest";

import type { Config } from "../config/schema.ts";
import type { EventKindDescriptor, ToolDescriptor } from "./descriptors.ts";
import type { EventOccurrence } from "./events.ts";

export type GatewayToCore =
  | { type: "init"; config: Config }
  | { type: "ping" }
  | { type: "call"; id: number; tool: string; input: unknown };

export type CoreToGateway =
  | { type: "ready"; tools: Array<ToolDescriptor>; eventKinds: Array<EventKindDescriptor> }
  | { type: "pong" }
  | { type: "result"; id: number; result: CallResult }
  | { type: "event"; event: EventOccurrence };

export type CallResult = { ok: true; output: JsonValue } | { ok: false; error: CallError };

export interface CallError {
  code: CallErrorCode;
  message: string;
}

export type CallErrorCode =
  | "unknown_tool"
  | "invalid_input"
  | "not_connected"
  | "failed"
  | "core_unavailable";
