import type { Bot, BotOptions } from "mineflayer";

import { createBot } from "mineflayer";
import { connect } from "node:net";
import chatLoader from "prismarine-chat";
import { z } from "zod";

import type { Config } from "../config/schema.ts";
import type { Emit } from "./events/event.ts";

import { log } from "../log.ts";
import { defineEventKind } from "./events/event.ts";

export const connected = defineEventKind({
  kind: "connection.connected",
  description: "The bot joined the Minecraft server and spawned.",
  payload: z.object({ username: z.string() }),
});

export const disconnected = defineEventKind({
  kind: "connection.disconnected",
  description: "The connection to the Minecraft server ended.",
  payload: z.object({ reason: z.string() }),
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

export class Connection {
  readonly #config: Config["minecraft"];
  readonly #emit: Emit;
  readonly #onEnd: () => void;
  #bot: Bot | undefined;

  constructor(config: Config["minecraft"], emit: Emit, onEnd: () => void) {
    this.#config = config;
    this.#emit = emit;
    this.#onEnd = onEnd;
  }

  // The bot, from the moment it spawns until the connection ends.
  get bot(): Bot | undefined {
    return this.#bot;
  }

  connect(): void {
    const { host, port, username, auth, version, profilesDirectory, resolveSrv } = this.#config;
    const options: BotOptions = {
      host,
      port,
      username,
      auth,
      logErrors: false,
      onMsaCode: (data) => {
        this.#emit(msaCode, { verificationUri: data.verification_uri, userCode: data.user_code });
      },
    };
    if (version !== undefined) {
      options.version = version;
    }
    if (profilesDirectory !== undefined) {
      options.profilesFolder = profilesDirectory;
    }
    if (!resolveSrv) {
      options.connect = (client) => {
        client.setSocket(connect(port, host));
      };
    }

    const bot = createBot(options);
    bot.once("spawn", () => {
      this.#bot = bot;
      this.#emit(connected, { username: bot.username });
    });
    bot.on("kicked", (reason) => {
      // The reason is a chat component, in JSON or NBT depending on the version.
      const text = chatLoader(bot.version).fromNotch(reason).toString();
      this.#emit(kicked, { reason: text });
    });
    bot.on("error", (error) => {
      log("error", "connection", error.message);
      this.#emit(connectionError, { message: error.message });
    });
    bot.once("end", (reason) => {
      this.#bot = undefined;
      this.#onEnd();
      this.#emit(disconnected, { reason });
    });
  }
}
