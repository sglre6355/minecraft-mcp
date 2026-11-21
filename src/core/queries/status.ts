import { z } from "zod";

import { airLevel } from "../events/oxygen.ts";
import { defineQuery } from "./query.ts";

// The weather as the game names it. A thunderstorm is rain with thunder on top.
export function weather(raining: boolean, thunder: number): "clear" | "rain" | "thunder" {
  if (!raining) {
    return "clear";
  }
  return thunder > 0 ? "thunder" : "rain";
}

export const status = defineQuery({
  name: "status",
  description:
    "Report the bot's position, dimension, game mode, health, food and air, with the time of day and the weather. timeOfDay counts ticks from sunrise at 0 to 24000, with noon at 6000, sunset at 12000 and midnight at 18000. A bed takes the bot at night or in a thunderstorm.",
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
      timeOfDay: bot.time.timeOfDay,
      isDay: bot.time.isDay,
      weather: weather(bot.isRaining, bot.thunderState),
    });
  },
});
