// @vitest-environment node
// T8-07 item 5: a device probe that never answers is "cannot tell" after a bounded wait, so a gateway is still built
// and the sign-in and server screens never wait forever on the player module's initialize.
import { afterEach, describe, expect, it, vi } from "vitest";
import vectors from "../packages/core/tests/fixtures/device-capability-probes.json";
import { webCrypto } from "../packages/core/src/adapters/web-crypto";
import type { LibraryItem } from "../packages/core/src/domain/catalog";
import type { PlayerCapabilities } from "../packages/core/src/domain/player-engine";
import { QueueTransport, queryValue, recorded } from "../packages/core/src/jellyfin/device-test-support";
import { createAppGatewayFactory, PROBE_LIMIT_MS } from "../apps/tv/src/host/gateway";

const SERVER = "http://127.0.0.1:8096";
const INSTALL_ID = "7e1d9a4c-3b2f-4a6e-8d5c-1f0e9b8a7c6d";
const ITEM: LibraryItem = { id: "item-h264", name: "Fixture", type: "Movie", resumePositionTicks: 0, played: false };
const EMULATOR_LIKE = (vectors.cases as unknown as { name: string; capabilities: PlayerCapabilities }[]).find((entry) =>
  entry.name.includes("emulator-like"),
)!.capabilities;

function host() {
  const transport = new QueueTransport([recorded("12.4.0", "conversion-h264"), recorded("12.4.0", "device-conversion-h264")]);
  return { transport, made: { crypto: webCrypto, transport, installId: async () => INSTALL_ID } };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("T8-07 item 5: a probe that never answers is cannot tell", () => {
  it("waits at most ten seconds by default", () => {
    expect(PROBE_LIMIT_MS).toBe(10_000);
  });

  it("builds the gateway once the limit passes and sends the forced-conversion request", async () => {
    vi.useFakeTimers();
    const { transport, made } = host();
    const building = createAppGatewayFactory(made, () => new Promise<PlayerCapabilities>(() => {}), 50)(SERVER);
    await vi.advanceTimersByTimeAsync(50);
    const gateway = await building;
    vi.useRealTimers();
    await gateway.login("tester", "password");
    await gateway.createPlaybackPlan(ITEM, 0).catch((error: unknown) => error);
    expect(transport.posts).toHaveLength(2);
    expect(queryValue(transport.posts[1], "EnableDirectPlay")).toBe("false");
  });

  it("does not wait before the limit and clears its timer once the probe answers", async () => {
    vi.useFakeTimers();
    const { transport, made } = host();
    const gateway = await createAppGatewayFactory(made, async () => EMULATOR_LIKE, 50)(SERVER);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    await gateway.login("tester", "password");
    await gateway.createPlaybackPlan(ITEM, 0).catch((error: unknown) => error);
    expect(transport.posts).toHaveLength(1);
  });

  it("is still cannot tell when the probe throws before answering", async () => {
    const { transport, made } = host();
    const gateway = await createAppGatewayFactory(made, () => {
      throw new Error("module not loaded");
    })(SERVER);
    await gateway.login("tester", "password");
    await gateway.createPlaybackPlan(ITEM, 0).catch((error: unknown) => error);
    expect(transport.posts).toHaveLength(2);
  });
});
