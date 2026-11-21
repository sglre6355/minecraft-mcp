import { parseArgs } from "node:util";

import { loadConfig } from "./config/load.ts";
import { serve } from "./gateway/serve.ts";
import { log } from "./log.ts";

const usage = "Usage: minecraft-mcp serve [--config <path>]";

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: { config: { type: "string", short: "c", default: "minecraft-mcp.toml" } },
    allowPositionals: true,
  });
  if (positionals.length !== 1 || positionals[0] !== "serve") {
    throw new Error(usage);
  }

  const { config, token } = await loadConfig(values.config, process.env);
  const running = await serve({ config, token });

  const shutdown = () => {
    running.stop().then(
      () => process.exit(0),
      (error: unknown) => {
        log("error", "cli", error instanceof Error ? error.message : String(error));
        process.exit(1);
      },
    );
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

try {
  await main();
} catch (error) {
  log("error", "cli", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
