import type { CoreToGateway, GatewayToCore } from "../protocol/messages.ts";

// A stand-in core for the supervisor tests. The tool name selects the behaviour.

declare const self: Worker;

function post(message: CoreToGateway): void {
  self.postMessage(message);
}

self.addEventListener("message", (event: MessageEvent<GatewayToCore>) => {
  const message = event.data;
  switch (message.type) {
    case "init":
      if (message.config.minecraft.host === "fail-to-start") {
        throw new Error("cannot start");
      }
      post({
        type: "ready",
        tools: [{ kind: "query", name: "echo", description: "", inputSchema: {} }],
        eventKinds: [],
      });
      if (message.config.minecraft.host === "crash-after-ready") {
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
