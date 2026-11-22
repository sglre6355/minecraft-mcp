import { z } from "zod";

// A piece of text as Minecraft sends it, when it is an object: the text, the pieces that
// follow it, and for a text the game translates, its key and what goes into it.
const piece = z.looseObject({
  text: z.union([z.string(), z.number(), z.boolean()]).optional(),
  translate: z.string().optional(),
  with: z.array(z.unknown()).optional(),
  extra: z.array(z.unknown()).optional(),
});

function flat(part: unknown): string {
  if (typeof part === "string" || typeof part === "number" || typeof part === "boolean") {
    return String(part);
  }
  if (Array.isArray(part)) {
    return part.map(flat).join("");
  }
  const parsed = piece.safeParse(part);
  if (!parsed.success) {
    return "";
  }
  const { text, translate, with: filled = [], extra = [] } = parsed.data;
  // The game holds the sentence for a key. Without it, the key and what goes into it are all
  // there is to show.
  const own =
    text === undefined ? [translate, ...filled.map(flat)].filter(Boolean).join(" ") : String(text);
  return own + extra.map(flat).join("");
}

// The words of a text from the server, without color and style. The text comes as a piece
// or as the JSON of one.
export function plain(text: unknown): string {
  if (typeof text !== "string") {
    return flat(text);
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed === null ? text : flat(parsed);
  } catch {
    return text;
  }
}

// A text of at most `most` characters, with a note on what was cut off.
export function clip(text: string, most: number): string {
  return text.length <= most
    ? text
    : `${text.slice(0, most)} (${text.length - most} more characters)`;
}
