import { z } from "zod";

import { defineCommand } from "./command.ts";

// The longest message a Minecraft server accepts.
const maxLength = 256;

export const chatInput = z.object({
  // A server kicks a player whose message holds a control character or a section sign.
  // Mineflayer sends each line of a message on its own, so a line break could start a command.
  message: z
    .string()
    .min(1)
    .max(maxLength)
    .regex(/^[^\p{Cc}§]+$/u, "A message is one line without control characters or §."),
  to: z
    .string()
    .regex(/^\w{1,16}$/, "A player's name is 1 to 16 letters, digits or underscores.")
    .optional()
    .describe("Whisper to this player only."),
});

// Whether the server would run the message as a command when it is sent to everyone.
export function isServerCommand(message: string): boolean {
  return message.startsWith("/");
}

export const chat = defineCommand({
  name: "chat",
  description: "Say something in the chat, to everyone or as a whisper to one player.",
  input: chatInput,
  run({ bot, config }, input) {
    if (input.to !== undefined) {
      bot.whisper(input.to, input.message);
    } else if (isServerCommand(input.message) && !config.chat.allowCommands) {
      throw new Error("Server commands are switched off. See `chat.allowCommands` in the config.");
    } else {
      bot.chat(input.message);
    }
    return Promise.resolve({ sent: true });
  },
});
