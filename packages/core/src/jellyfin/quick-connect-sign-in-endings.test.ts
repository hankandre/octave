// How a Quick Connect run ends in two cases the frozen tests do not reach: a call the transport reports as cancelled
// though the run aborted nothing, and a listener that throws once the session exists.
import { describe, expect, it } from "vitest";
import { POLL_INTERVAL_MS } from "../domain/quick-connect";
import { FakeClock } from "../ports/fake-clock";
import type { JellyfinGateway } from "./gateway";
import { startQuickConnect, type QuickConnectState } from "./quick-connect-sign-in";

const cancelled = Object.assign(new Error("cancelled"), { code: "cancelled" });
const settle = () => new Promise<void>((done) => setImmediate(done));

function gatewayWith(overrides: Partial<Record<keyof JellyfinGateway, unknown>> = {}): JellyfinGateway {
  return {
    serverUrl: "https://server.example.test",
    hostClass: "public",
    quickConnectEnabled: async () => true,
    initiateQuickConnect: async () => ({ secret: "secret", code: "482913" }),
    pollQuickConnect: async () => ({ authenticated: true }),
    authenticateWithQuickConnect: async () => undefined,
    logout: async () => undefined,
    ...overrides,
  } as unknown as JellyfinGateway;
}

async function run(gateway: JellyfinGateway, listener: (state: QuickConnectState) => void) {
  const clock = new FakeClock(0);
  startQuickConnect(gateway, clock, listener);
  await settle();
  await clock.advance(POLL_INTERVAL_MS);
  await settle();
}

describe("a call cancelled by the transport while the run aborted nothing", () => {
  const reject = async () => {
    throw cancelled;
  };

  it.each(["quickConnectEnabled", "initiateQuickConnect", "pollQuickConnect", "authenticateWithQuickConnect"] as const)(
    "%s ends in a failure the viewer can retry",
    async (call) => {
      const states: QuickConnectState[] = [];

      await run(gatewayWith({ [call]: reject }), (state) => states.push(state));

      expect(states.at(-1)).toEqual({ phase: "failed", failure: "other" });
    },
  );
});

describe("a listener that throws once the session exists", () => {
  it("is not taken for a poll that failed", async () => {
    const thrown = new Error("the app could not open");
    const unhandled: unknown[] = [];
    const keep = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", keep);
    const phases: string[] = [];

    await run(gatewayWith(), (state) => {
      phases.push(state.phase);
      if (state.phase === "signed-in") throw thrown;
    });
    await settle();
    process.off("unhandledRejection", keep);

    expect(phases).toEqual(["starting", "waiting", "signing-in", "signed-in"]);
    expect(unhandled).toEqual([thrown]);
  });
});
