// T4-03 items 3, 4 and 7 (docs/specs/T4-03.md, D2 and D4): the run that polls one Quick Connect code and signs in, over
// the real gateway, a scripted transport and a fake clock.
//
// Testing contract (the implementer builds to it)
// - `startQuickConnect(gateway, clock, listener)` returns `{ newCode(), stop() }`; the listener gets each QuickConnectState
//   (starting | unavailable | waiting | signing-in | signed-in | failed). A waiting or signing-in state is exactly
//   `{ phase, code, link }`, and a failed one exactly `{ phase, failure }`.
// - Time comes only from the Clock. The crypto here is Node's SHA-256, which answers within microtasks, so advancing the
//   fake clock also settles every request it starts.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Crypto } from "../ports/crypto";
import { FakeClock } from "../ports/fake-clock";
import { TransportError, type SessionId, type SignInRequest, type SignInResult, type Transport, type TransportRequest, type TransportResponse } from "../ports/transport";
import { JellyfinGateway } from "./gateway";
import { startQuickConnect } from "./quick-connect-sign-in";

const SERVER = "https://media.example.test";
const SECRET = "0123456789abcdef".repeat(4);
const NEW_SECRET = "fedcba9876543210".repeat(4);
const CODE = "482913";
const NEW_CODE = "731205";
const LINK = `${SERVER}/web/#/quickconnect?code=${CODE}`;
const NEW_LINK = `${SERVER}/web/#/quickconnect?code=${NEW_CODE}`;
const INTERVAL = 5_000;
const LIFETIME = 600_000;

const ENABLED = "GET /QuickConnect/Enabled";
const INITIATE = "POST /QuickConnect/Initiate";
const CONNECT = "GET /QuickConnect/Connect";

const crypto: Crypto = {
  sha256Hex: async (text) => createHash("sha256").update(text).digest("hex"),
  randomId: () => "11111111-1111-4111-8111-111111111111",
};

type Answer = TransportResponse | Error | Promise<TransportResponse>;
type SignInAnswer = SignInResult | Error | Promise<SignInResult>;

const ok = (body: unknown): TransportResponse => ({ status: 200, body });
const status = (code: number): TransportResponse => ({ status: code, body: undefined });
const pending = () => ok({ Authenticated: false });
const approved = () => ok({ Authenticated: true });
const session = (): SignInResult => ({ session: "session-1", userId: "user-1", userName: "Louise" });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Answers each route from its queue; the last answer of a queue repeats. */
class ScriptedTransport implements Transport {
  readonly requests: TransportRequest[] = [];
  readonly signIns: SignInRequest[] = [];
  readonly ended: SessionId[] = [];
  signInAnswer: SignInAnswer = session();
  private readonly queues = new Map<string, Answer[]>([
    [ENABLED, [ok(true)]],
    [INITIATE, [ok({ Secret: SECRET, Code: CODE }), ok({ Secret: NEW_SECRET, Code: NEW_CODE })]],
    [CONNECT, [pending()]],
  ]);

  script(route: string, ...answers: Answer[]): void {
    this.queues.set(route, answers);
  }

  count(route: string): number {
    return this.requests.filter((request) => `${request.method} ${request.path}` === route).length;
  }

  polledSecrets(): string[] {
    return this.requests.filter((request) => request.path === "/QuickConnect/Connect").map((request) => new Map(request.query).get("secret") ?? "");
  }

  signal(route: string): AbortSignal | undefined {
    return this.requests.filter((request) => `${request.method} ${request.path}` === route).at(-1)?.signal;
  }

  async request(request: TransportRequest): Promise<TransportResponse> {
    this.requests.push(request);
    const queue = this.queues.get(`${request.method} ${request.path}`);
    if (queue === undefined) throw new TransportError("refused");
    const answer = queue.length > 1 ? queue.shift() : queue[0];
    if (answer === undefined) throw new TransportError("refused");
    if (answer instanceof Error) throw answer;
    return answer;
  }

  async signIn(request: SignInRequest): Promise<SignInResult> {
    this.signIns.push(request);
    if (this.signInAnswer instanceof Error) throw this.signInAnswer;
    return this.signInAnswer;
  }

  async endSession(id: SessionId): Promise<void> {
    this.ended.push(id);
  }
}

type State = Parameters<Parameters<typeof startQuickConnect>[2]>[0];

async function start(arrange: (transport: ScriptedTransport) => void = () => undefined) {
  const transport = new ScriptedTransport();
  arrange(transport);
  const gateway = new JellyfinGateway(SERVER, crypto, transport, "install-1");
  const clock = new FakeClock(1_000_000);
  const states: State[] = [];
  const run = startQuickConnect(gateway, clock, (state) => states.push(state));
  await clock.advance(0);
  return { transport, gateway, clock, states, run };
}

type Rig = Awaited<ReturnType<typeof start>>;

const last = (rig: Rig): State | undefined => rig.states.at(-1);
const phases = (rig: Rig): string[] => rig.states.map((state) => state.phase).filter((phase) => phase !== "starting");
const failedWith = (failure: string) => ({ phase: "failed", failure });

/** Stops, then shows nothing more is sent or reported however long the clock runs. */
async function expectSilentAfterStop(rig: Rig): Promise<void> {
  const sent = rig.transport.requests.length + rig.transport.signIns.length;
  const reported = rig.states.length;
  await rig.clock.advance(60_000);
  expect(rig.transport.requests.length + rig.transport.signIns.length).toBe(sent);
  expect(rig.states).toHaveLength(reported);
}

describe("T4-03 item 3: the TV polls until the code is approved, then signs in", () => {
  it("T4-03 item 3: shows the code and link, and polls on the five-second interval and not before", async () => {
    const rig = await start();

    expect(last(rig)).toEqual({ phase: "waiting", code: CODE, link: LINK });
    expect(rig.transport.count(CONNECT)).toBe(0);
    await rig.clock.advance(INTERVAL - 1);
    expect(rig.transport.count(CONNECT)).toBe(0);
    await rig.clock.advance(1);
    expect(rig.transport.count(CONNECT)).toBe(1);
    await rig.clock.advance(INTERVAL);
    expect(rig.transport.count(CONNECT)).toBe(2);
    expect(rig.transport.polledSecrets()).toEqual([SECRET, SECRET]);
  });

  it("T4-03 item 3: the first approved poll signs in once with the code's secret, and nothing polls afterwards", async () => {
    const rig = await start((transport) => transport.script(CONNECT, pending(), pending(), approved()));

    await rig.clock.advance(3 * INTERVAL);

    expect(rig.transport.signIns).toHaveLength(1);
    expect(rig.transport.signIns[0]?.credential).toEqual({ kind: "quick-connect", secret: SECRET });
    expect(phases(rig)).toEqual(["waiting", "signing-in", "signed-in"]);
    expect(rig.states.find((state) => state.phase === "signing-in")).toEqual({ phase: "signing-in", code: CODE, link: LINK });
    await rig.clock.advance(60_000);
    expect(rig.transport.count(CONNECT)).toBe(3);
    expect(rig.transport.signIns).toHaveLength(1);
  });

  it("T4-03 item 3: a tick that comes while a poll is in flight sends nothing", async () => {
    const slow = deferred<TransportResponse>();
    const rig = await start((transport) => transport.script(CONNECT, slow.promise, pending()));

    await rig.clock.advance(4 * INTERVAL);
    expect(rig.transport.count(CONNECT)).toBe(1);

    slow.resolve(pending());
    await rig.clock.advance(INTERVAL);
    expect(rig.transport.count(CONNECT)).toBe(2);
  });

  it("T4-03 item 3: stop() while the run is still starting sends nothing more and reports nothing", async () => {
    const slow = deferred<TransportResponse>();
    const rig = await start((transport) => transport.script(INITIATE, slow.promise));

    rig.run.stop();
    expect(rig.transport.signal(INITIATE)?.aborted).toBe(true);
    slow.resolve(ok({ Secret: SECRET, Code: CODE }));
    await rig.clock.advance(0);

    expect(phases(rig)).toEqual([]);
    await expectSilentAfterStop(rig);
  });

  it("T4-03 item 3: stop() during the wait sends nothing for the next minute", async () => {
    const rig = await start();
    await rig.clock.advance(INTERVAL);

    rig.run.stop();

    await expectSilentAfterStop(rig);
  });

  it("T4-03 item 3: stop() during a poll aborts it, and a late approval signs nobody in", async () => {
    const slow = deferred<TransportResponse>();
    const rig = await start((transport) => transport.script(CONNECT, slow.promise));
    await rig.clock.advance(INTERVAL);

    rig.run.stop();
    expect(rig.transport.signal(CONNECT)?.aborted).toBe(true);
    slow.resolve(approved());
    await rig.clock.advance(0);

    expect(rig.transport.signIns).toEqual([]);
    await expectSilentAfterStop(rig);
  });

  it("T4-03 item 3: a sign-in that finishes after stop() is ended exactly once and never reported", async () => {
    const slow = deferred<SignInResult>();
    const rig = await start((transport) => {
      transport.script(CONNECT, approved());
      transport.signInAnswer = slow.promise;
    });
    await rig.clock.advance(INTERVAL);
    expect(rig.transport.signIns).toHaveLength(1);

    rig.run.stop();
    expect(rig.transport.signIns[0]?.signal?.aborted).toBe(true);
    slow.resolve(session());
    await rig.clock.advance(0);

    expect(rig.transport.ended).toEqual(["session-1"]);
    expect(() => rig.gateway.sessionId()).toThrow();
    expect(phases(rig)).toEqual(["waiting", "signing-in"]);
    await expectSilentAfterStop(rig);
  });

  it("T4-03 item 3: a sign-in that fails after stop() ends nothing and reports nothing", async () => {
    const slow = deferred<SignInResult>();
    const rig = await start((transport) => {
      transport.script(CONNECT, approved());
      transport.signInAnswer = slow.promise;
    });
    await rig.clock.advance(INTERVAL);

    rig.run.stop();
    slow.reject(new TransportError("status", 401));
    await rig.clock.advance(0);

    expect(rig.transport.ended).toEqual([]);
    expect(phases(rig)).toEqual(["waiting", "signing-in"]);
  });

  it("T4-03 item 3: stop() after a successful sign-in leaves the session alone", async () => {
    const rig = await start((transport) => transport.script(CONNECT, approved()));
    await rig.clock.advance(INTERVAL);
    expect(last(rig)).toEqual({ phase: "signed-in" });

    rig.run.stop();
    await rig.clock.advance(60_000);

    expect(rig.transport.ended).toEqual([]);
    expect(rig.gateway.sessionId()).toBe("session-1");
  });

  it("T4-03 item 3: two failed polls in a row keep waiting, and only the third in a row gives up", async () => {
    const rig = await start((transport) =>
      transport.script(CONNECT, new TransportError("network"), new TransportError("timeout"), pending(), new TransportError("timeout"), new TransportError("network"), new TransportError("network")),
    );

    await rig.clock.advance(5 * INTERVAL);
    expect(last(rig)?.phase).toBe("waiting");
    await rig.clock.advance(INTERVAL);

    expect(last(rig)).toEqual(failedWith("unreachable"));
    await rig.clock.advance(60_000);
    expect(rig.transport.count(CONNECT)).toBe(6);
  });

  it.each([
    ["Enabled", ENABLED],
    ["Initiate", INITIATE],
  ])("T4-03 item 3: a network failure on %s gives up at once", async (_name, route) => {
    const rig = await start((transport) => transport.script(route, new TransportError("network")));

    expect(last(rig)).toEqual(failedWith("unreachable"));
    expect(rig.transport.count(CONNECT)).toBe(0);
  });

  it("T4-03 item 3: a timed-out sign-in gives up at once, and polling stays stopped", async () => {
    const rig = await start((transport) => {
      transport.script(CONNECT, approved());
      transport.signInAnswer = new TransportError("timeout");
    });

    await rig.clock.advance(INTERVAL);

    expect(last(rig)).toEqual(failedWith("unreachable"));
    await rig.clock.advance(60_000);
    expect(rig.transport.count(CONNECT)).toBe(1);
  });
});

describe("T4-03 item 4: an expired or refused code, and a new one", () => {
  it.each([
    [404, "expired"],
    [401, "refused"],
    [403, "refused"],
  ])("T4-03 item 4: a poll answered %s gives %s and stops polling", async (code, failure) => {
    const rig = await start((transport) => transport.script(CONNECT, status(code)));

    await rig.clock.advance(INTERVAL);

    expect(last(rig)).toEqual(failedWith(failure));
    await rig.clock.advance(60_000);
    expect(rig.transport.count(CONNECT)).toBe(1);
    expect(rig.transport.signIns).toEqual([]);
  });

  it.each([
    [404, "expired"],
    [401, "refused"],
  ])("T4-03 item 4: a sign-in answered %s gives %s", async (code, failure) => {
    const rig = await start((transport) => {
      transport.script(CONNECT, approved());
      transport.signInAnswer = new TransportError("status", code);
    });

    await rig.clock.advance(INTERVAL);

    expect(last(rig)).toEqual(failedWith(failure));
    await rig.clock.advance(60_000);
    expect(rig.transport.count(CONNECT)).toBe(1);
  });

  it("T4-03 item 4: a server that never answers 404 is given up on after ten minutes", async () => {
    const rig = await start();

    await rig.clock.advance(LIFETIME - 1);
    expect(last(rig)?.phase).toBe("waiting");
    await rig.clock.advance(1);

    expect(last(rig)).toEqual(failedWith("expired"));
    const polls = rig.transport.count(CONNECT);
    expect(polls).toBeLessThanOrEqual(120);
    await rig.clock.advance(60_000);
    expect(rig.transport.count(CONNECT)).toBe(polls);
  });

  it("T4-03 item 4: a new code sends one Initiate and then polls only the new secret", async () => {
    const rig = await start((transport) => transport.script(CONNECT, status(404), pending()));
    await rig.clock.advance(INTERVAL);
    expect(last(rig)).toEqual(failedWith("expired"));

    rig.run.newCode();
    await rig.clock.advance(0);

    expect(last(rig)).toEqual({ phase: "waiting", code: NEW_CODE, link: NEW_LINK });
    expect(rig.transport.count(INITIATE)).toBe(2);
    expect(rig.transport.count(ENABLED)).toBe(1);
    await rig.clock.advance(2 * INTERVAL);
    expect(rig.transport.polledSecrets()).toEqual([SECRET, NEW_SECRET, NEW_SECRET]);
  });

  it("T4-03 item 4: the new code's ten minutes start when it is made", async () => {
    const rig = await start((transport) => transport.script(CONNECT, status(404), pending()));
    await rig.clock.advance(INTERVAL);
    await rig.clock.advance(LIFETIME / 2);
    rig.run.newCode();
    await rig.clock.advance(0);

    await rig.clock.advance(LIFETIME - 1);

    expect(last(rig)?.phase).toBe("waiting");
    await rig.clock.advance(1);
    expect(last(rig)).toEqual(failedWith("expired"));
  });

  it.each([
    ["an unreachable server", new TransportError("network")],
    ["any other failure", status(500)],
  ])("T4-03 item 4: after %s, trying again asks whether Quick Connect is on first", async (_name, answer) => {
    const rig = await start((transport) => transport.script(INITIATE, answer, ok({ Secret: NEW_SECRET, Code: NEW_CODE })));
    expect(last(rig)?.phase).toBe("failed");

    rig.run.newCode();
    await rig.clock.advance(0);

    expect(rig.transport.count(ENABLED)).toBe(2);
    expect(last(rig)).toEqual({ phase: "waiting", code: NEW_CODE, link: NEW_LINK });
  });

  it("T4-03 item 4: asking for a new code while one is waiting changes nothing", async () => {
    const rig = await start();

    rig.run.newCode();
    await rig.clock.advance(INTERVAL);

    expect(rig.transport.count(INITIATE)).toBe(1);
    expect(rig.transport.count(CONNECT)).toBe(1);
    expect(last(rig)).toEqual({ phase: "waiting", code: CODE, link: LINK });
  });
});

describe("T4-03 item 7: a server with Quick Connect off or not built is skipped", () => {
  it.each([
    ["Enabled answers false", (transport: ScriptedTransport) => transport.script(ENABLED, ok(false)), 0],
    ["Enabled is not built (404)", (transport: ScriptedTransport) => transport.script(ENABLED, status(404)), 0],
    ["Initiate answers 401", (transport: ScriptedTransport) => transport.script(INITIATE, status(401)), 1],
  ])("T4-03 item 7: when %s the run is unavailable and sends nothing with a secret", async (_name, arrange, initiates) => {
    const rig = await start(arrange);

    await rig.clock.advance(60_000);

    expect(last(rig)).toEqual({ phase: "unavailable" });
    expect(rig.transport.count(INITIATE)).toBe(initiates);
    expect(rig.transport.count(CONNECT)).toBe(0);
    expect(rig.transport.signIns).toEqual([]);
    expect(rig.transport.requests.filter((request) => (request.query ?? []).some(([name]) => name === "secret"))).toEqual([]);
  });
});
