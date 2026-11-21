import type { CoreToGateway, GatewayToCore, Target } from "../protocol/messages.ts";

// A stand-in core for the supervisor tests. The tool name selects the behavior of a call,
// and the list of plugins in the config selects the behavior at startup.

declare const self: Worker;

function post(message: CoreToGateway): void {
  self.postMessage(message);
}

// What this core was told to join again when it started.
let rejoin: Target | null = null;

self.addEventListener("message", (event: MessageEvent<GatewayToCore>) => {
  const message = event.data;
  switch (message.type) {
    case "init":
      rejoin = message.rejoin;
      if (message.config.plugins.includes("fail-to-start")) {
        throw new Error("cannot start");
      }
      post({
        type: "ready",
        tools: [{ kind: "query", name: "echo", description: "", inputSchema: {} }],
        eventKinds: [],
      });
      if (message.config.plugins.includes("crash-after-ready")) {
        setTimeout(() => {
          throw new Error("crashed after ready");
        }, 0);
      }
      break;
    case "ping":
      post({ type: "pong" });
      break;
    case "call":
      if (message.tool === "hang") {
        for (;;) {
          // Blocks the thread.
        }
      }
      if (message.tool === "crash") {
        throw new Error("crashed on request");
      }
      if (message.tool === "join") {
        post({
          type: "target",
          target: {
            host: "mc.example",
            port: 1,
            username: "bot",
            auth: "offline",
            version: null,
            resolveSrv: true,
          },
        });
      }
      if (message.tool === "rejoin") {
        post({ type: "result", id: message.id, result: { ok: true, output: rejoin } });
        break;
      }
      if (message.tool === "emit") {
        post({
          type: "event",
          event: { kind: "test.event", occurredAt: new Date(0), payload: {} },
        });
      }
      post({
        type: "result",
        id: message.id,
        result: { ok: true, output: JSON.stringify(message.input) },
      });
      break;
  }
});
