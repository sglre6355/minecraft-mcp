import { attack } from "./actions/attack.ts";
import { breakBlock } from "./actions/break-block.ts";
import { putInChest, takeFromChest, viewChest } from "./actions/chest.ts";
import { collectBlock } from "./actions/collect-block.ts";
import { craft } from "./actions/craft.ts";
import { clearFurnace, smelt } from "./actions/furnace.ts";
import { consume, discard, equip, give } from "./actions/inventory.ts";
import { moveTo } from "./actions/move-to.ts";
import { placeBlock } from "./actions/place-block.ts";
import { followPlayer, goToPlayer } from "./actions/players.ts";
import { sleep } from "./actions/sleep.ts";
import { useOn } from "./actions/use-on.ts";
import { chat as say } from "./commands/chat.ts";
import { chat } from "./events/chat.ts";
import { damage } from "./events/damage.ts";
import { hunger } from "./events/hunger.ts";
import { life } from "./events/life.ts";
import { oxygen } from "./events/oxygen.ts";
import { definePlugin } from "./plugin-api.ts";
import { blockAt } from "./queries/block-at.ts";
import { craftable } from "./queries/craftable.ts";
import { craftingPlan } from "./queries/crafting-plan.ts";
import { findBlocks } from "./queries/find-blocks.ts";
import { inventory } from "./queries/inventory.ts";
import { lookAround } from "./queries/look-around.ts";
import { look } from "./queries/look.ts";
import { nearbyEntities } from "./queries/nearby-entities.ts";
import { pathTo } from "./queries/path-to.ts";
import { readSign } from "./queries/read-sign.ts";
import { status } from "./queries/status.ts";
import { drowning } from "./reflexes/drowning/drowning.ts";

export const builtin = definePlugin({
  name: "builtin",
  actions: [
    moveTo,
    goToPlayer,
    followPlayer,
    breakBlock,
    collectBlock,
    placeBlock,
    useOn,
    attack,
    equip,
    consume,
    discard,
    give,
    craft,
    smelt,
    clearFurnace,
    viewChest,
    putInChest,
    takeFromChest,
    sleep,
  ],
  queries: [
    status,
    inventory,
    look,
    lookAround,
    nearbyEntities,
    findBlocks,
    blockAt,
    readSign,
    pathTo,
    craftable,
    craftingPlan,
  ],
  commands: [say],
  reflexes: [drowning],
  eventSources: [chat, damage, oxygen, hunger, life],
});
