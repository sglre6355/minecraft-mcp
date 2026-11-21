import type { Bot } from "mineflayer";

import type { Policy, Reflex } from "../reflex.ts";

import { airLevel, fullAir } from "../../events/oxygen.ts";
import { aborted } from "../../wait.ts";

export interface Situation {
  // Air left, from 0 to 20.
  oxygen: number;
}

export type Decision = "surface";

// Leaves about four seconds before the air is gone. The bot rises about three blocks a second.
const lowAir = 6;

export const rule: Policy<Situation, Decision> = {
  decide: (situation) => Promise.resolve(situation.oxygen <= lowAir ? "surface" : undefined),
};

// Whether a reading under water calls for a decision.
// `actedAt` is the air the reflex last acted on, if it has acted since the bot last had full air.
export function callsForDecision(oxygen: number, actedAt: number | undefined): boolean {
  if (actedAt === undefined) {
    return oxygen < fullAir;
  }
  // The bot takes damage once the air is gone, which is worse than what the reflex acted on.
  return oxygen === 0 && actedAt > 0;
}

// A standing player's eyes are this far above the feet.
const eyeHeight = 1.62;

// These blocks hold water without being waterlogged.
const waterPlants = new Set(["seagrass", "tall_seagrass", "kelp", "kelp_plant", "bubble_column"]);

function headInWater(bot: Bot): boolean {
  const block = bot.blockAt(bot.entity.position.offset(0, eyeHeight, 0));
  if (block === null) {
    return false;
  }
  return block.name === "water" || block.isWaterlogged === true || waterPlants.has(block.name);
}

// Blocks a tick. A bot that swims up moves at about 0.13, and one that sinks at -0.025.
const risingSpeed = 0.05;

// A connection has its own bot, so what the reflex remembers ends with the connection.
const actedAt = new WeakMap<Bot, number>();

export const drowning: Reflex<Situation, Decision> = {
  name: "drowning",
  limitMs: 20_000,
  observe(bot) {
    const oxygen = airLevel(bot.oxygenLevel);
    if (oxygen === fullAir) {
      actedAt.delete(bot);
    }
    if (!headInWater(bot) || !callsForDecision(oxygen, actedAt.get(bot))) {
      return undefined;
    }
    // Whatever moves the bot up is already doing what the reflex would do.
    if (bot.entity.velocity.y > risingSpeed) {
      return undefined;
    }
    return { oxygen };
  },
  policy: rule,
  // Swims up and stays at the surface until the air is back.
  async execute({ bot, signal }) {
    let lowest = airLevel(bot.oxygenLevel);
    actedAt.set(bot, lowest);
    const refilled = Promise.withResolvers<void>();
    const onBreath = () => {
      const oxygen = airLevel(bot.oxygenLevel);
      // Air that runs out while the reflex acts is part of what it acted on.
      lowest = Math.min(lowest, oxygen);
      actedAt.set(bot, lowest);
      if (oxygen === fullAir) {
        refilled.resolve();
      }
    };
    // The server sends no air level when the bot comes back to life, so the wait would not end.
    const onDeath = () => {
      actedAt.delete(bot);
      refilled.reject(new Error("The bot died before it reached air."));
    };
    bot.on("breath", onBreath);
    bot.once("death", onDeath);
    bot.setControlState("jump", true);
    try {
      await Promise.race([refilled.promise, aborted(signal)]);
    } finally {
      bot.setControlState("jump", false);
      bot.off("breath", onBreath);
      bot.off("death", onDeath);
    }
  },
};
