import type { Bot, BotOptions } from "mineflayer";

import { createBot } from "mineflayer";
import { connect } from "node:net";
import chatLoader from "prismarine-chat";
import { z } from "zod";

import type { Config } from "../config/schema.ts";
import type { Target } from "../protocol/messages.ts";
import type { Emit } from "./events/event.ts";
import type { Attempt, AttemptEvents, Cause } from "./presence.ts";

import { log } from "../log.ts";
import { defineEventKind } from "./events/event.ts";

export const connected = defineEventKind({
  kind: "connection.connected",
  description: "The bot joined the Minecraft server and spawned.",
  payload: z.object({ username: z.string() }),
});

export const disconnected = defineEventKind({
  kind: "connection.disconnected",
  description:
    "The bot is out of the Minecraft server, or an attempt to join failed. When `willReconnect` is true it joins again by itself and keeps trying until it is in or `disconnect` is called. Otherwise it stays out until `connect` is called.",
  payload: z.object({
    reason: z.string(),
    willReconnect: z.boolean(),
    retryInSeconds: z.number().nullable().describe("When the first try to join again starts."),
  }),
});

export const kicked = defineEventKind({
  kind: "connection.kicked",
  description: "The Minecraft server kicked the bot.",
  payload: z.object({ reason: z.string() }),
});

export const msaCode = defineEventKind({
  kind: "connection.msa_code",
  description:
    "Microsoft sign-in needs a person to open the URL and enter the code before the bot can join.",
  payload: z.object({ verificationUri: z.url(), userCode: z.string() }),
});

export const connectionError = defineEventKind({
  kind: "connection.error",
  description:
    "The connection to the Minecraft server reported an error. The bot may never join, or a disconnect may follow.",
  payload: z.object({ message: z.string() }),
});

export const connectionEventKinds = [connected, disconnected, kicked, msaCode, connectionError];

// The longest the server may take from the connection to letting the bot into the world.
const joinLimitMs = 30_000;

export interface DialHooks {
  // The bot joined the server and has a body in the world.
  onSpawn: (bot: Bot) => void;
  // A bot that had spawned is gone.
  onEnd: (bot: Bot) => void;
}

// Makes one attempt to join a server with Mineflayer.
export function dial(
  target: Target,
  settings: Config["minecraft"],
  auto: boolean,
  emit: Emit,
  hooks: DialHooks,
  events: AttemptEvents,
): Attempt {
  const options: BotOptions = {
    host: target.host,
    port: target.port,
    username: target.username,
    auth: target.auth,
    logErrors: false,
    onMsaCode: (data) => {
      emit(msaCode, { verificationUri: data.verification_uri, userCode: data.user_code });
    },
  };
  if (target.version !== null) {
    options.version = target.version;
  }
  if (settings.profilesDirectory !== undefined) {
    options.profilesFolder = settings.profilesDirectory;
  }
  if (!target.resolveSrv) {
    options.connect = (client) => {
      client.setSocket(connect(target.port, target.host));
    };
  }

  const bot = createBot(options);
  let spawned = false;
  let requested = false;
  // `end` says the socket closed, whatever happened. The reason comes before it.
  let cause: Cause | undefined;

  // A server that takes the connection and then says nothing would hold the attempt for good.
  // The clock starts at the connection, since signing in before it can take a person minutes.
  let silence: ReturnType<typeof setTimeout> | undefined;
  bot._client.once("connect", () => {
    silence = setTimeout(() => {
      cause ??= {
        kind: "lost",
        detail: `The server did not let the bot in within ${joinLimitMs / 1000} seconds.`,
      };
      bot.end();
    }, joinLimitMs);
  });

  bot.once("spawn", () => {
    clearTimeout(silence);
    spawned = true;
    hooks.onSpawn(bot);
    emit(connected, { username: bot.username });
    events.joined();
  });
  bot.on("kicked", (reason) => {
    // The reason is a chat component, in JSON or NBT depending on the version.
    const message = chatLoader(bot.version).fromNotch(reason);
    const text = message.toString();
    cause = { kind: "kicked", key: message.translate ?? null, text };
    emit(kicked, { reason: text });
  });
  let over = false;
  bot.on("error", (error) => {
    log("error", "connection", error.message);
    cause ??= { kind: "lost", detail: error.message };
    // A try to get back in fails over and over while the server is away,
    // and an attempt that is over can still report an error late.
    if (!over && (spawned || !auto)) {
      emit(connectionError, { message: error.message });
    }
  });
  bot.once("end", (reason) => {
    over = true;
    clearTimeout(silence);
    if (spawned) {
      hooks.onEnd(bot);
    }
    events.ended(requested ? { kind: "requested" } : (cause ?? { kind: "lost", detail: reason }));
  });

  return {
    hangUp: () => {
      requested = true;
      bot.end();
    },
  };
}
