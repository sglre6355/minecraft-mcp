import { moveTo } from "./actions/move-to.ts";
import { chat } from "./events/chat.ts";
import { damage } from "./events/damage.ts";
import { hunger } from "./events/hunger.ts";
import { life } from "./events/life.ts";
import { oxygen } from "./events/oxygen.ts";
import { definePlugin } from "./plugin-api.ts";
import { status } from "./queries/status.ts";
import { drowning } from "./reflexes/drowning/drowning.ts";

export const builtin = definePlugin({
  name: "builtin",
  actions: [moveTo],
  queries: [status],
  reflexes: [drowning],
  eventSources: [chat, damage, oxygen, hunger, life],
});
