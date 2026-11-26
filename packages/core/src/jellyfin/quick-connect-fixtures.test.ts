// T4-03 item 8 (docs/specs/T4-03.md, D11): the answers recorded from the pinned Jellyfin 10.11.7 and 12.4.0 servers,
// replayed through the real gateway and the Quick Connect run.
//
// The files are recorded output, made only by tests/integration/record-quick-connect-fixtures.mjs, and never edited by
// hand. In each version's folder, one file per scene of D11, shaped `{ request: { method, path, queryNames }, status,
// body }` (Secret scrubbed to 64 hex characters, Code to 482913):
// - quick-connect-enabled.json, quick-connect-initiate.json,
// - quick-connect-connect-pending.json (before approval), quick-connect-connect-approved.json (after it),
// - quick-connect-authenticate.json (status and body shape of AuthenticateWithQuickConnect),
// - quick-connect-connect-unknown.json (a secret the server does not hold),
// - quick-connect-disabled-enabled.json, quick-connect-disabled-initiate.json, quick-connect-disabled-connect.json.
//
// Kotlin, not JavaScript, parses the AuthenticateWithQuickConnect answer, so the transport's signIn here is built from
// that scene's recorded status alone: 2xx is a session, anything else is TransportError("status", n).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Crypto } from "../ports/crypto";
import { FakeClock } from "../ports/fake-clock";
import { TransportError, type SignInRequest, type SignInResult, type Transport, type TransportRequest, type TransportResponse } from "../ports/transport";
import { JellyfinGateway } from "./gateway";

const RECORDER = "node tests/integration/record-quick-connect-fixtures.mjs";
const fixtures = join(__dirname, "../../tests/fixtures/jellyfin");
const SERVER = "https://media.example.test";
const CODE = "482913";
const INTERVAL = 5_000;

const SCENES = [
  "enabled",
  "initiate",
  "connect-pending",
  "connect-approved",
  "authenticate",
  "connect-unknown",
  "disabled-enabled",
  "disabled-initiate",
  "disabled-connect",
] as const;
type Scene = (typeof SCENES)[number];

type Recording = { request: { method: string; path: string; queryNames: string[] }; status: number; body: unknown };

const crypto: Crypto = {
  sha256Hex: async (text) => createHash("sha256").update(text).digest("hex"),
  randomId: () => "11111111-1111-4111-8111-111111111111",
};

function load(version: string): Record<Scene, Recording> {
  const missing = SCENES.map((scene) => join(fixtures, version, `quick-connect-${scene}.json`)).filter((file) => !existsSync(file));
  if (missing.length > 0) {
    throw new Error(`Jellyfin ${version} has no Quick Connect recordings (${missing.length} of ${SCENES.length} missing, first ${missing[0]}). Record them with: ${RECORDER}`);
  }
  const read = (scene: Scene): Recording => JSON.parse(readFileSync(join(fixtures, version, `quick-connect-${scene}.json`), "utf8")) as Recording;
  return Object.fromEntries(SCENES.map((scene) => [scene, read(scene)])) as Record<Scene, Recording>;
}

/** Answers each route from the scenes given, in order (the last one repeats), and checks the request against each recording. */
class ReplayTransport implements Transport {
  readonly polls: string[] = [];
  readonly signIns: SignInRequest[] = [];

  constructor(
    private readonly routes: Record<string, Recording[]>,
    private readonly authenticate?: Recording,
  ) {}

  async request(request: TransportRequest): Promise<TransportResponse> {
    const route = `${request.method} ${request.path}`;
    const queue = this.routes[route];
    if (queue === undefined) throw new TransportError("refused");
    const recording = queue.length > 1 ? queue.shift() : queue[0];
    if (recording === undefined) throw new TransportError("refused");
    expect({ method: request.method, path: request.path, queryNames: (request.query ?? []).map(([name]) => name) }).toEqual(recording.request);
    if (request.path === "/QuickConnect/Connect") this.polls.push(new Map(request.query).get("secret") ?? "");
    return { status: recording.status, body: recording.body };
  }

  async signIn(request: SignInRequest): Promise<SignInResult> {
    this.signIns.push(request);
    const recorded = this.authenticate;
    if (recorded === undefined) throw new TransportError("refused");
    if (recorded.status < 200 || recorded.status >= 300) throw new TransportError("status", recorded.status);
    const user = (recorded.body as { User?: { Id?: string; Name?: string } }).User;
    return { session: "session-fake", userId: user?.Id ?? "user-fake", ...(user?.Name === undefined ? {} : { userName: user.Name }) };
  }

  async endSession(): Promise<void> {}
}

const ENABLED = "GET /QuickConnect/Enabled";
const INITIATE = "POST /QuickConnect/Initiate";
const CONNECT = "GET /QuickConnect/Connect";

/** Runs over the recordings and advances the clock by `intervals` polls. The run is imported here, after the files are read. */
async function replay(transport: ReplayTransport, intervals: number) {
  const { startQuickConnect } = await import("./quick-connect-sign-in");
  const gateway = new JellyfinGateway(SERVER, crypto, transport, "install-1");
  const clock = new FakeClock(0);
  const states: Array<{ phase: string }> = [];
  startQuickConnect(gateway, clock, (state) => states.push(state));
  await clock.advance(intervals * INTERVAL);
  return { gateway, states, last: states.at(-1) };
}

describe.each(["10.11.7", "12.4.0"])("T4-03 item 8: Jellyfin %s's recorded Quick Connect answers", (version) => {
  it("T4-03 item 8: an approved code signs in, and every request is the one the server was recorded answering", async () => {
    const recorded = load(version);
    const secret = (recorded.initiate.body as { Secret: string }).Secret;
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    const transport = new ReplayTransport(
      { [ENABLED]: [recorded.enabled], [INITIATE]: [recorded.initiate], [CONNECT]: [recorded["connect-pending"], recorded["connect-approved"]] },
      recorded.authenticate,
    );

    const run = await replay(transport, 3);

    expect(run.states.map((state) => state.phase).filter((phase) => phase !== "starting")).toEqual(["waiting", "signing-in", "signed-in"]);
    expect(run.states.find((state) => state.phase === "waiting")).toMatchObject({ code: CODE });
    expect(transport.polls).toEqual([secret, secret]);
    expect(transport.signIns.map((signIn) => signIn.credential)).toEqual([{ kind: "quick-connect", secret }]);
    expect(run.gateway.sessionId()).toBe("session-fake");
  });

  it("T4-03 item 8: a secret the server no longer holds is an expired code", async () => {
    const recorded = load(version);
    const transport = new ReplayTransport({ [ENABLED]: [recorded.enabled], [INITIATE]: [recorded.initiate], [CONNECT]: [recorded["connect-unknown"]] });

    const run = await replay(transport, 1);

    expect(run.last).toEqual({ phase: "failed", failure: "expired" });
  });

  it("T4-03 item 8: with Quick Connect off, the check says so and the step is skipped", async () => {
    const recorded = load(version);
    const transport = new ReplayTransport({ [ENABLED]: [recorded["disabled-enabled"]] });

    const run = await replay(transport, 1);

    expect(run.last).toEqual({ phase: "unavailable" });
  });

  it("T4-03 item 8: with Quick Connect turned off before the code is made, the step is skipped", async () => {
    const recorded = load(version);
    const transport = new ReplayTransport({ [ENABLED]: [recorded.enabled], [INITIATE]: [recorded["disabled-initiate"]] });

    const run = await replay(transport, 1);

    expect(run.last).toEqual({ phase: "unavailable" });
  });

  it("T4-03 item 8: with Quick Connect turned off while the TV waits, the code is refused", async () => {
    const recorded = load(version);
    const transport = new ReplayTransport({ [ENABLED]: [recorded.enabled], [INITIATE]: [recorded.initiate], [CONNECT]: [recorded["disabled-connect"]] });

    const run = await replay(transport, 1);

    expect(run.last).toEqual({ phase: "failed", failure: "refused" });
  });
});
