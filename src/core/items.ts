import type { Bot } from "mineflayer";

// A type alias, since an interface does not pass as JSON output.
export type Stack = {
  name: string;
  count: number;
};

// Adds up the stacks of each item. The result is ordered by name.
export function countByName(stacks: ReadonlyArray<Stack>): Array<Stack> {
  const counts = new Map<string, number>();
  for (const stack of stacks) {
    counts.set(stack.name, (counts.get(stack.name) ?? 0) + stack.count);
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

// What the later counts hold beyond the earlier ones.
export function gained(before: ReadonlyArray<Stack>, after: ReadonlyArray<Stack>): Array<Stack> {
  const had = new Map(before.map((stack) => [stack.name, stack.count]));
  return after.flatMap((stack) => {
    const more = stack.count - (had.get(stack.name) ?? 0);
    return more > 0 ? [{ name: stack.name, count: more }] : [];
  });
}

// The item of that name in the bot's Minecraft version.
export function itemNamed(bot: Bot, name: string) {
  const item = bot.registry.itemsByName[name];
  if (item === undefined) {
    throw new Error(`No item is named "${name}".`);
  }
  return item;
}

// The block of that name in the bot's Minecraft version.
export function blockNamed(bot: Bot, name: string) {
  const block = bot.registry.blocksByName[name];
  if (block === undefined) {
    throw new Error(`No block is named "${name}".`);
  }
  return block;
}

// How many of the item the bot carries.
export function countOf(bot: Bot, name: string): number {
  let count = 0;
  for (const stack of bot.inventory.items()) {
    if (stack.name === name) {
      count += stack.count;
    }
  }
  return count;
}

// One stack of the item from the bot's inventory.
export function carried(bot: Bot, name: string) {
  itemNamed(bot, name);
  const stack = bot.inventory.items().find((candidate) => candidate.name === name);
  if (stack === undefined) {
    throw new Error(`The bot carries no ${name}.`);
  }
  return stack;
}
