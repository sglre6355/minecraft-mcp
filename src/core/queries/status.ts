import { z } from "zod";

import { airLevel } from "../events/oxygen.ts";
import { defineQuery } from "./query.ts";

export const status = defineQuery({
  name: "status",
  description: "Report the bot's position, dimension, game mode, health, food and air.",
  input: z.object({}),
  run({ bot }) {
    const { x, y, z: zCoordinate } = bot.entity.position;
    return Promise.resolve({
      username: bot.username,
      position: { x, y, z: zCoordinate },
      onGround: bot.entity.onGround,
      dimension: bot.game.dimension,
      gameMode: bot.game.gameMode,
      health: bot.health,
      food: bot.food,
      saturation: bot.foodSaturation,
      oxygen: airLevel(bot.oxygenLevel),
    });
  },
});
