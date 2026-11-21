import { definePlugin } from "./plugin-api.ts";
import { status } from "./queries/status.ts";

export const builtin = definePlugin({
  name: "builtin",
  queries: [status],
});
