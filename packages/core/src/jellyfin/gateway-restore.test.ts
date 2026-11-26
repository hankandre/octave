// T4-05 item 2 (docs/specs/T4-05.md, D6; spec check notes 8): the gateway takes a restored session only for its own
// server and only after a connect() on it answered with the record's server id; it writes nothing to the confirmation
// store, and it sends nothing itself. sessionStanding asks GET /Users/Me with the session: a 2xx is valid, a 401 is asked
// once more and a second 401 is revoked, and anything else throws.
//
// The testing contract is in ./restore-test-support.ts.
import { describe, expect, it, vi } from "vitest";
import { MemoryLanHttpConfirmations } from "../lan-http-confirmations";
import { TransportError } from "../ports/transport";
import { JellyfinGateway } from "./gateway";
import { HTTPS, LAN, ME, OTHER_HTTPS, OTHER_ID, PROBE, SERVER_ID, SESSION, RestoreTransport, crypto, info, restoredAt, status } from "./restore-test-support";

function gatewayAt(server: string, transport: RestoreTransport, confirmations = new MemoryLanHttpConfirmations()): JellyfinGateway {
  return new JellyfinGateway(server, crypto, transport, "22222222-2222-4222-8222-222222222222", confirmations);
}

/** Calls adopt, whether it throws or rejects. A gateway with no adopt fails here, not as a refusal. */
function adopting(gateway: JellyfinGateway, restored: ReturnType<typeof restoredAt>): Promise<unknown> {
  expect(typeof gateway.adopt).toBe("function");
  return Promise.resolve().then(() => gateway.adopt(restored));
}

describe("T4-05 item 2: adopt takes a restored session only after the server answered with the record's id", () => {
  it("T4-05 item 2: before any connect(), adopt throws and the gateway stays signed out", async () => {
    const gateway = gatewayAt(HTTPS, new RestoreTransport());

    await expect(adopting(gateway, restoredAt(HTTPS))).rejects.toThrow();

    expect(gateway.currentUserName()).toBeUndefined();
    expect(() => gateway.sessionId()).toThrow();
  });

  it("T4-05 item 2: after a connect() that answered another id, adopt throws", async () => {
    const transport = new RestoreTransport().script(PROBE, info(OTHER_ID));
    const gateway = gatewayAt(HTTPS, transport);
    await gateway.connect();

    await expect(adopting(gateway, restoredAt(HTTPS))).rejects.toThrow();

    expect(() => gateway.sessionId()).toThrow();
  });

  it("T4-05 item 2: after a matching connect() and then a second, different answer, adopt throws", async () => {
    const transport = new RestoreTransport().script(PROBE, info(SERVER_ID), info(OTHER_ID));
    const gateway = gatewayAt(HTTPS, transport);
    await gateway.connect();
    await gateway.connect();

    await expect(adopting(gateway, restoredAt(HTTPS))).rejects.toThrow();

    expect(() => gateway.sessionId()).toThrow();
  });

  it("T4-05 item 2: a record for another server is refused even when the id matches", async () => {
    const transport = new RestoreTransport().script(PROBE, info(SERVER_ID));
    const gateway = gatewayAt(HTTPS, transport);
    await gateway.connect();

    await expect(adopting(gateway, restoredAt(OTHER_HTTPS))).rejects.toThrow();

    expect(() => gateway.sessionId()).toThrow();
  });

  it("T4-05 item 2: after a matching connect() it takes the session, sends nothing, and stores no confirmation", async () => {
    const confirmations = new MemoryLanHttpConfirmations();
    const remember = vi.spyOn(confirmations, "remember");
    const transport = new RestoreTransport().script(PROBE, info(SERVER_ID));
    const gateway = gatewayAt(LAN, transport, confirmations);
    await gateway.connect();
    const sent = transport.requests.length;

    await adopting(gateway, restoredAt(LAN));

    expect(gateway.sessionId()).toBe(SESSION);
    expect(gateway.currentUserName()).toBe("Fixture Viewer");
    expect(transport.requests.length).toBe(sent);
    expect(remember).not.toHaveBeenCalled();
    expect(confirmations.has({ serverId: SERVER_ID, origin: new URL(LAN).origin })).toBe(false);
  });
});

describe("T4-05 item 3: sessionStanding asks the server whether the session still stands", () => {
  async function adopted(...answers: Parameters<RestoreTransport["script"]>[1][]) {
    const transport = new RestoreTransport().script(PROBE, info(SERVER_ID)).script(ME, ...answers);
    const gateway = gatewayAt(HTTPS, transport);
    await gateway.connect();
    await adopting(gateway, restoredAt(HTTPS));
    return { gateway, transport };
  }

  const meRequests = (transport: RestoreTransport) => transport.sent().filter((line) => line.startsWith(ME));

  it("T4-05 item 3: a 2xx is valid", async () => {
    const { gateway, transport } = await adopted(status(200));

    await expect(gateway.sessionStanding()).resolves.toBe("valid");

    expect(meRequests(transport)).toEqual([`${ME} session:${SESSION}`]);
  });

  it("T4-05 item 3: two 401s are revoked", async () => {
    const { gateway, transport } = await adopted(status(401));

    await expect(gateway.sessionStanding()).resolves.toBe("revoked");

    expect(meRequests(transport)).toEqual([`${ME} session:${SESSION}`, `${ME} session:${SESSION}`]);
  });

  it("T4-05 item 3: one 401 then a 2xx is valid", async () => {
    const { gateway } = await adopted(status(401), status(200));

    await expect(gateway.sessionStanding()).resolves.toBe("valid");
  });

  it("T4-05 item 3: anything else throws", async () => {
    for (const answer of [status(500), status(403), new TransportError("network")]) {
      const { gateway } = await adopted(answer);

      await expect(gateway.sessionStanding()).rejects.toBeDefined();
    }
  });
});
