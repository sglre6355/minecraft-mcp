import type { Bot } from "mineflayer";

import { goals } from "mineflayer-pathfinder";

import { walk } from "./walk.ts";

type Vector = Bot["entity"]["position"];

// Mineflayer takes positions as vectors of its own type. The bot's position supplies one.
export function vectorAt(bot: Bot, x: number, y: number, z: number): Vector {
  return bot.entity.position.clone().set(x, y, z);
}

// The block at a position, which must be in a part of the world the bot has loaded.
export function blockAt(bot: Bot, x: number, y: number, z: number) {
  const block = bot.blockAt(vectorAt(bot, x, y, z));
  if (block === null) {
    throw new Error(`The world at ${x}, ${y}, ${z} is not loaded. Move closer first.`);
  }
  return block;
}

// Close enough for the bot's hands.
const armsLength = 3;

// Walks until a position is within the bot's reach.
export async function approach(bot: Bot, position: Vector, signal: AbortSignal): Promise<void> {
  const goal = new goals.GoalNear(position.x, position.y, position.z, armsLength);
  if (!(await walk(bot, goal, signal))) {
    throw new Error(
      `No path leads to within reach of ${position.x}, ${position.y}, ${position.z}.`,
    );
  }
}

// The entity an ID from nearby_entities stands for.
export function entityWithId(bot: Bot, entityId: number) {
  const entity = bot.entities[entityId];
  if (entity === undefined || entity === bot.entity) {
    throw new Error(
      `No entity has the ID ${entityId}. It may be gone. Ask nearby_entities for the current ones.`,
    );
  }
  return entity;
}

// A player the bot can see.
export function playerInSight(bot: Bot, username: string) {
  if (bot.players[username] === undefined) {
    throw new Error(`No player named ${username} is on the server.`);
  }
  // The server sends a player's entity only while the player is near.
  const entity = Object.values(bot.entities).find(
    (candidate) => candidate.type === "player" && candidate.username === username,
  );
  if (entity === undefined) {
    throw new Error(`${username} is too far away to see.`);
  }
  return entity;
}

// The nearest block with one of the names, within the range.
export function nearestBlock(bot: Bot, names: ReadonlyArray<string>, range: number) {
  const ids = names.flatMap((name) => {
    const id = bot.registry.blocksByName[name]?.id;
    return id === undefined ? [] : [id];
  });
  return bot.findBlock({ matching: ids, maxDistance: range });
}
