// T4-05 items 2 and 3 (docs/specs/T4-05.md, D6; spec check notes 1 and 6): at launch the core takes the newest stored
// session, probes its server, adopts the session only when the probe answered with the record's server id, and asks
// GET /Users/Me. Home opens only on a 2xx. Two 401s are a confirmed revoke: the session is ended and the viewer returns
// to sign-in with the server and the user's name. Anything else is `unavailable`, with the record kept and no request
// carrying the session sent before the id matched, on a second try too. The probe and the validation each get 5 s, and
// a probe that runs out of time reads as unreachable, with its sentence's code.
//
// The testing contract is in ./restore-test-support.ts.
import { describe, expect, it, vi } from "vitest";
import { MemoryLanHttpConfirmations } from "../lan-http-confirmations";
import { FakeClock } from "../ports/fake-clock";
import { TransportError } from "../ports/transport";
import { restoreSession } from "./restore-session";
import {
  HANG,
  HTTPS,
  LAN,
  ME,
  OTHER_HTTPS,
  OTHER_ID,
  OTHER_SESSION,
  PROBE,
  SERVER_ID,
  SESSION,
  RestoreTransport,
  gatewaysOver,
  info,
  listing,
  restoredAt,
  status,
} from "./restore-test-support";

const TIMEOUT_MS = 5_000;

function rig(transport = new RestoreTransport(), confirmations = new MemoryLanHttpConfirmations()) {
  const over = gatewaysOver(transport, confirmations);
  return { transport, ...over };
}

type Outcome = Awaited<ReturnType<typeof restoreSession>>;

async function run(transport: RestoreTransport, source: ReturnType<typeof listing>, confirmations?: MemoryLanHttpConfirmations): Promise<Outcome> {
  const { gateways } = rig(transport, confirmations);
  return restoreSession({ restore: source, gateways, timeoutMs: TIMEOUT_MS });
}

const tokenless = (route: string): string => `${route} tokenless`;
const withSession = (route: string, session = SESSION): string => `${route} session:${session}`;

describe("T4-05 item 2: a validated restore opens Home", () => {
  it("T4-05 item 2: nothing stored is `none`, with no request", async () => {
    const transport = new RestoreTransport();

    const outcome = await run(transport, listing());

    expect(outcome).toEqual({ kind: "none" });
    expect(transport.requests).toEqual([]);
  });

  it("T4-05 item 2: a probe with the record's id and a 2xx from /Users/Me is `signed-in`, with the session adopted", async () => {
    const transport = new RestoreTransport().script(PROBE, info()).script(ME, status(200));

    const outcome = await run(transport, listing(restoredAt(HTTPS)));

    expect(outcome.kind).toBe("signed-in");
    if (outcome.kind !== "signed-in") return;
    expect(outcome.serverName).toBe("Fixture Server");
    expect(outcome.gateway.serverUrl).toBe(HTTPS);
    expect(outcome.gateway.sessionId()).toBe(SESSION);
    expect(outcome.gateway.currentUserName()).toBe("Fixture Viewer");
    expect(transport.sent()).toEqual([tokenless(PROBE), withSession(ME)]);
    expect(transport.ended).toEqual([]);
  });

  it("T4-05 item 2: the probe and the validation each get 5 s", async () => {
    const transport = new RestoreTransport().script(PROBE, info()).script(ME, status(200));

    await run(transport, listing(restoredAt(HTTPS)));

    expect(transport.requests.map((request) => request.timeoutMs)).toEqual([TIMEOUT_MS, TIMEOUT_MS]);
  });

  it("T4-05 item 2: only the newest listed session is tried", async () => {
    const transport = new RestoreTransport().script(PROBE, info()).script(ME, status(200));
    const source = listing(restoredAt(HTTPS), restoredAt(OTHER_HTTPS, { session: OTHER_SESSION, serverId: OTHER_ID, userId: "user-2" }));

    const outcome = await run(transport, source);

    expect(outcome.kind).toBe("signed-in");
    expect(transport.requests.every((request) => !("server" in request.target) || request.target.server === HTTPS)).toBe(true);
    expect(transport.withSession().every((request) => "session" in request.target && request.target.session === SESSION)).toBe(true);
  });

  it("T4-05 item 2: on a private-LAN http:// server the id match stands in for the dialog, and no confirmation is stored", async () => {
    const confirmations = new MemoryLanHttpConfirmations();
    const remember = vi.spyOn(confirmations, "remember");
    const transport = new RestoreTransport().script(PROBE, info()).script(ME, status(200));

    const outcome = await run(transport, listing(restoredAt(LAN)), confirmations);

    expect(outcome.kind).toBe("signed-in");
    expect(transport.sent()).toEqual([tokenless(PROBE), withSession(ME)]);
    expect(remember).not.toHaveBeenCalled();
    expect(confirmations.has({ serverId: SERVER_ID, origin: new URL(LAN).origin })).toBe(false);
  });
});

describe("T4-05 item 2: a restore that cannot be validated is `unavailable`, keeps the record and sends no session request", () => {
  const unmatched = [
    { name: "an unreachable server", probe: new TransportError("network"), failure: "unreachable" },
    { name: "another server id", probe: info(OTHER_ID), failure: "other" },
    { name: "an answer with no server id", probe: { status: 200, body: { ServerName: "Fixture Server", Version: "10.11.11" } }, failure: "other" },
    { name: "an unsupported version", probe: info(SERVER_ID, "10.10.7"), failure: "unsupported-version" },
    { name: "a redirect", probe: new TransportError("redirect"), failure: "redirect" },
    { name: "an unusable answer", probe: { status: 200, body: "<html>captive portal</html>" }, failure: "other" },
    { name: "an error status", probe: status(502), failure: "other" },
  ] as const;

  for (const server of [HTTPS, LAN]) {
    it.each(unmatched)(`T4-05 item 2: $name at ${server} is unavailable with failure $failure, and nothing carries the session`, async ({ probe, failure }) => {
      const transport = new RestoreTransport().script(PROBE, probe).script(ME, status(200));

      const outcome = await run(transport, listing(restoredAt(server)));

      expect(outcome).toEqual({ kind: "unavailable", address: server, failure });
      expect(transport.withSession()).toEqual([]);
      expect(transport.ended).toEqual([]);
    });
  }

  it("T4-05 item 2: Try again runs the same checks, and the second try sends no session request either", async () => {
    const transport = new RestoreTransport().script(PROBE, new TransportError("network"), info(OTHER_ID)).script(ME, status(200));
    const source = listing(restoredAt(LAN));
    const { gateways } = rig(transport);

    const first = await restoreSession({ restore: source, gateways, timeoutMs: TIMEOUT_MS });
    const second = await restoreSession({ restore: source, gateways, timeoutMs: TIMEOUT_MS });

    expect(first).toEqual({ kind: "unavailable", address: LAN, failure: "unreachable" });
    expect(second).toEqual({ kind: "unavailable", address: LAN, failure: "other" });
    expect(transport.sent()).toEqual([tokenless(PROBE), tokenless(PROBE)]);
    expect(transport.ended).toEqual([]);
  });

  it("T4-05 item 2: a validation that fails is unavailable and keeps the record", async () => {
    for (const [answer, failure] of [
      [status(500), "other"],
      [new TransportError("network"), "unreachable"],
    ] as const) {
      const transport = new RestoreTransport().script(PROBE, info()).script(ME, answer);

      const outcome = await run(transport, listing(restoredAt(HTTPS)));

      expect(outcome).toEqual({ kind: "unavailable", address: HTTPS, failure });
      expect(transport.sent()).toEqual([tokenless(PROBE), withSession(ME)]);
      expect(transport.ended).toEqual([]);
    }
  });

  it("T4-05 item 2: a probe that never answers reads as unreachable once its 5 s have passed", async () => {
    const clock = new FakeClock();
    const transport = new RestoreTransport().script(PROBE, HANG);
    transport.deadline = (request, expire) => void clock.after(request.timeoutMs, expire);
    let settled: Outcome | undefined;

    void run(transport, listing(restoredAt(HTTPS))).then((outcome) => {
      settled = outcome;
    });
    await clock.advance(TIMEOUT_MS - 1);
    expect(settled).toBeUndefined();
    await clock.advance(1);

    expect(settled).toEqual({ kind: "unavailable", address: HTTPS, failure: "unreachable" });
    expect(transport.withSession()).toEqual([]);
  });

  it("T4-05 item 2: a validation that never answers reads as unreachable once its 5 s have passed, and the record is kept", async () => {
    const clock = new FakeClock();
    const transport = new RestoreTransport().script(PROBE, info()).script(ME, HANG);
    transport.deadline = (request, expire) => void clock.after(request.timeoutMs, expire);
    let settled: Outcome | undefined;

    void run(transport, listing(restoredAt(HTTPS))).then((outcome) => {
      settled = outcome;
    });
    await clock.advance(TIMEOUT_MS - 1);
    expect(settled).toBeUndefined();
    await clock.advance(1);

    expect(settled).toEqual({ kind: "unavailable", address: HTTPS, failure: "unreachable" });
    expect(transport.ended).toEqual([]);
  });
});

describe("T4-05 item 3: a confirmed revoke returns the account to sign-in", () => {
  it("T4-05 item 3: two 401s from /Users/Me are `sign-in-again`, with the session ended by one logout", async () => {
    const transport = new RestoreTransport().script(PROBE, info()).script(ME, status(401));

    const outcome = await run(transport, listing(restoredAt(HTTPS)));

    expect(outcome.kind).toBe("sign-in-again");
    if (outcome.kind !== "sign-in-again") return;
    expect(outcome.userName).toBe("Fixture Viewer");
    expect(outcome.gateway.serverUrl).toBe(HTTPS);
    expect(outcome.connection).toMatchObject({ id: SERVER_ID, name: "Fixture Server", needsUnencryptedConfirmation: false });
    expect(outcome.gateway.currentUserName()).toBeUndefined();
    expect(transport.sent()).toEqual([tokenless(PROBE), withSession(ME), withSession(ME)]);
    expect(transport.ended).toEqual([SESSION]);
  });

  it("T4-05 item 3: on a private-LAN http:// server the connection still needs the confirmation", async () => {
    const transport = new RestoreTransport().script(PROBE, info()).script(ME, status(401));

    const outcome = await run(transport, listing(restoredAt(LAN)));

    expect(outcome.kind).toBe("sign-in-again");
    if (outcome.kind !== "sign-in-again") return;
    expect(outcome.connection.needsUnencryptedConfirmation).toBe(true);
    expect(outcome.gateway.serverUrl).toBe(LAN);
  });

  it("T4-05 item 3: one 401 alone does not end the session", async () => {
    const transport = new RestoreTransport().script(PROBE, info()).script(ME, status(401), status(200));

    const outcome = await run(transport, listing(restoredAt(HTTPS)));

    expect(outcome.kind).toBe("signed-in");
    expect(transport.sent()).toEqual([tokenless(PROBE), withSession(ME), withSession(ME)]);
    expect(transport.ended).toEqual([]);
  });

  it("T4-05 item 3: a record with no user name returns with none", async () => {
    const transport = new RestoreTransport().script(PROBE, info()).script(ME, status(401));
    const { userName: _dropped, ...unnamed } = restoredAt(HTTPS);

    const outcome = await run(transport, listing(unnamed));

    expect(outcome.kind).toBe("sign-in-again");
    if (outcome.kind !== "sign-in-again") return;
    expect(outcome.userName).toBeUndefined();
  });
});
