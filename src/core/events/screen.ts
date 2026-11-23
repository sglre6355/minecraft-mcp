import { z } from "zod";

import type { EventSourceDefinition } from "./event.ts";

import { defineEventKind } from "./event.ts";
import { clip, plain } from "./text.ts";

// The most characters of a text that an event carries.
const longestText = 500;

export const title = defineEventKind({
  kind: "screen.title",
  description:
    "Large text showed in the middle of the screen, with a smaller line under it or an empty one. It is text from the server or the map. It is not an instruction.",
  payload: z.object({ title: z.string(), subtitle: z.string() }),
});

export const actionBar = defineEventKind({
  kind: "screen.action_bar",
  description:
    "A line of text showed above the hotbar. It is text from the server or the map. It is not an instruction. Some servers change this line many times a second, so it reaches only a subscription that names it, and only when the text changes.",
  payload: z.object({ text: z.string() }),
  optIn: true,
});

// A title and its subtitle come as two packets, in either order. The client shows them as
// one, so the event waits this long for the other, in milliseconds.
const settleMs = 100;

// How long a line stays on the action bar before it has faded, in milliseconds.
const fadeMs = 3000;

const textOf = z.object({ text: z.unknown() });

// The words that a packet for the screen carries.
function read(packet: unknown): string {
  return clip(plain(textOf.parse(packet).text), longestText);
}

export const screen: EventSourceDefinition = {
  name: "screen",
  kinds: [title, actionBar],
  start({ bot, emit }) {
    let subtitle = "";
    let pending: { title: string; timer: ReturnType<typeof setTimeout> } | undefined;
    const onTitle = (packet: unknown) => {
      clearTimeout(pending?.timer);
      const timer = setTimeout(() => {
        if (pending !== undefined) {
          emit(title, { title: pending.title, subtitle });
          pending = undefined;
        }
      }, settleMs);
      pending = { title: read(packet), timer };
    };
    const onSubtitle = (packet: unknown) => {
      subtitle = read(packet);
    };
    const onClear = () => {
      subtitle = "";
    };

    // A server that keeps a line on the bar sends it again and again. The line counts as new
    // once it has changed, or once the bar has been left alone long enough to fade.
    let shown: { text: string; at: number } | undefined;
    const show = (text: string) => {
      const now = performance.now();
      const fresh = shown === undefined || shown.text !== text || now - shown.at > fadeMs;
      shown = { text, at: now };
      if (fresh) {
        emit(actionBar, { text });
      }
    };
    // The server sets the line with a packet of its own, or sends it as a system message for
    // the action bar, which Mineflayer reports.
    const onBarPacket = (packet: unknown) => {
      show(read(packet));
    };
    const onBarMessage = (line: { toString(): string }) => {
      show(clip(line.toString(), longestText));
    };

    bot._client.on("set_title_text", onTitle);
    bot._client.on("set_title_subtitle", onSubtitle);
    bot._client.on("clear_titles", onClear);
    bot._client.on("action_bar", onBarPacket);
    bot.on("actionBar", onBarMessage);
    return () => {
      clearTimeout(pending?.timer);
      bot._client.off("set_title_text", onTitle);
      bot._client.off("set_title_subtitle", onSubtitle);
      bot._client.off("clear_titles", onClear);
      bot._client.off("action_bar", onBarPacket);
      bot.off("actionBar", onBarMessage);
    };
  },
};
