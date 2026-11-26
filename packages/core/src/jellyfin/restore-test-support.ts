// Doubles for the T4-05 restore tests (docs/specs/T4-05.md, D6). Ordinary source: no test library, no adapter. Every
// address is a documentation or private-range fixture, every id and token made up.
//
// Testing contract (the implementer builds to it)
// - `ports/transport.ts` exports `RestoredSession` = { session, server, deviceId, userId, serverId, userName? } and
//   `SessionRestore` = { restoreSessions(): Promise<readonly RestoredSession[]> }. `Transport` keeps its three members.
// - `JellyfinGateway.adopt(restored)` takes a session for the gateway; it throws (or rejects) unless `restored.server`
//   normalizes to its `serverUrl` and the last `connect()` on it answered with `restored.serverId`.
// - `JellyfinGateway.sessionStanding(signal?)` answers "valid" or "revoked" (two 401s), and throws on anything else.
// - `restoreSession({ restore, gateways, timeoutMs }, signal?)` (./restore-session) answers one of
//   { kind: "none" }, { kind: "signed-in", gateway, serverName }, { kind: "sign-in-again", gateway, connection, userName? }
//   and { kind: "unavailable", address, failure } (failure a ServerChoiceFailure). `gateways(server)` builds the gateway.
import { JellyfinGateway } from "./gateway";
import { MemoryLanHttpConfirmations } from "../lan-http-confirmations";
import type { Crypto } from "../ports/crypto";
import { TransportError, type SessionId, type SignInRequest, type SignInResult, type Transport, type TransportRequest, type TransportResponse } from "../ports/transport";

export const SERVER_ID = "0123456789abcdef0123456789abcdef";
export const OTHER_ID = "fedcba9876543210fedcba9876543210";
export const HTTPS = "https://media.example.test";
export const OTHER_HTTPS = "https://other.example.test";
export const LAN = "http://192.168.1.5:8096";
export const SESSION = "0123456789abcdef0123456789abcd01";
export const OTHER_SESSION = "0123456789abcdef0123456789abcd02";
export const PROBE = "GET /System/Info/Public";
export const ME = "GET /Users/Me";

export type Restored = {
  session: string;
  server: string;
  deviceId: string;
  userId: string;
  serverId: string;
  userName?: string;
};

export function restoredAt(server: string, over: Partial<Restored> = {}): Restored {
  return { session: SESSION, server, deviceId: "fixture-device-id-1", userId: "user-1", serverId: SERVER_ID, userName: "Fixture Viewer", ...over };
}

export const info = (id: string | undefined = SERVER_ID, version = "10.11.11"): TransportResponse => ({
  status: 200,
  body: { ServerName: "Fixture Server", Version: version, ...(id === undefined ? {} : { Id: id }) },
});

export const status = (code: number): TransportResponse => ({ status: code, body: undefined });

/** Never answers by itself: rejects with "cancelled" when its signal aborts, and with "timeout" when `deadline` expires it. */
export const HANG = "hang" as const;

type Answer = TransportResponse | Error | typeof HANG;

/** Answers "METHOD /path" from a queue whose last answer repeats; a route with no queue is unreachable. Records all. */
export class RestoreTransport implements Transport {
  readonly requests: TransportRequest[] = [];
  readonly ended: SessionId[] = [];
  readonly signIns: SignInRequest[] = [];
  private readonly queues = new Map<string, Answer[]>();
  /** Set by a test that runs fake timers: expire a hanging request once its timeoutMs has passed. */
  deadline: HangDeadline = () => undefined;

  script(route: string, ...answers: Answer[]): this {
    this.queues.set(route, answers);
    return this;
  }

  /** Each request as "METHOD /path" and whom it named: its session, or "tokenless". */
  sent(): string[] {
    return this.requests.map((request) => `${request.method} ${request.path} ${"session" in request.target ? `session:${request.target.session}` : "tokenless"}`);
  }

  /** The requests that carried a session. */
  withSession(): TransportRequest[] {
    return this.requests.filter((request) => "session" in request.target);
  }

  async signIn(request: SignInRequest): Promise<SignInResult> {
    this.signIns.push(request);
    throw new TransportError("refused");
  }

  request(request: TransportRequest): Promise<TransportResponse> {
    this.requests.push(request);
    const queue = this.queues.get(`${request.method} ${request.path}`);
    const answer = queue === undefined ? new TransportError("network") : queue.length > 1 ? queue.shift() : queue[0];
    if (answer === HANG) return hang(request, this.deadline);
    if (answer === undefined) return Promise.reject(new TransportError("network"));
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve(answer);
  }

  async endSession(session: SessionId): Promise<void> {
    this.ended.push(session);
  }
}

/** What a hanging request does besides waiting for its abort; a test that runs fake timers sets its own deadline. */
export type HangDeadline = (request: TransportRequest, expire: () => void) => void;

function hang(request: TransportRequest, deadline: HangDeadline): Promise<TransportResponse> {
  return new Promise((_resolve, reject) => {
    request.signal?.addEventListener("abort", () => reject(new TransportError("cancelled")), { once: true });
    deadline(request, () => reject(new TransportError("timeout")));
  });
}

export const crypto: Crypto = {
  sha256Hex: async () => "0".repeat(64),
  randomId: () => "11111111-1111-4111-8111-111111111111",
};

/** The gateway factory a restore is given, over one transport and one confirmation store. */
export function gatewaysOver(transport: Transport, confirmations = new MemoryLanHttpConfirmations()) {
  const built: JellyfinGateway[] = [];
  const gateways = async (server: string): Promise<JellyfinGateway> => {
    const gateway = new JellyfinGateway(server, crypto, transport, "22222222-2222-4222-8222-222222222222", confirmations);
    built.push(gateway);
    return gateway;
  };
  return { gateways, built, confirmations };
}

/** A restore source that lists `sessions`, newest first, and counts its calls. */
export function listing(...sessions: Restored[]) {
  const source = {
    calls: 0,
    async restoreSessions(): Promise<readonly Restored[]> {
      source.calls += 1;
      return sessions;
    },
  };
  return source;
}
