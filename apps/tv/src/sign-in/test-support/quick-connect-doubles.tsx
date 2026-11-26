// Doubles for the T4-03 sign-in tests (frozen with T4-03): a transport that answers the server probe, Quick Connect and
// Home's reads, the chosen server over the real gateway, and readers for the drawn QR code.
//
// Testing contract (the implementer builds to it)
// - `createQuickConnectStep({ clock })` (../quick-connect-step) returns the later step: it takes
//   `{ chosen, changeServer, onSignedIn?, openPassword? }` and is drawn inside `ChosenServerContext`. All its timing comes
//   from that clock, and it runs the core's `startQuickConnect` (@octave/core/src/jellyfin/quick-connect-sign-in).
// - `onSignedIn` gets exactly `{ gateway, serverName }`.
// - testIDs: sign-in-quick-connect (the step's root), sign-in-code (the code's Text, whose accessibilityLabel is the code
//   read digit by digit), sign-in-qr (the QR view), sign-in-new-code, sign-in-try-again, sign-in-change-server (the
//   buttons), and sign-in-status (the status line, drawn only when it has text, as on the server step).
// - The QR view is `accessible={false}`. Its style pads four modules on every side over a `text1` field. Each child is one
//   row of modules, in order; each child of a row is one run of equal modules, with a `width` of whole modules and a
//   `backgroundColor` of `onLight` (dark) or `text1`. A module is floor(px(480) / (size + 8)) wide.
// - Focus is claimed the app's two ways (sign-in-doubles.tsx, `focusClaim`).
import { act, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import type { TestInstance } from "test-renderer";
import { MemoryLanHttpConfirmations } from "@octave/core/src/lan-http-confirmations";
import { FakeClock } from "@octave/core/src/ports/fake-clock";
import type { Crypto } from "@octave/core/src/ports/crypto";
import { TransportError, type SessionId, type SignInRequest, type SignInResult, type Transport, type TransportRequest, type TransportResponse } from "@octave/core/src/ports/transport";
import { px } from "../../design/scale";
import { colors } from "../../design/tokens";
import { createGatewayFactory, type GatewayFactory } from "../../host/gateway";
import type { ChosenServer } from "../sign-in-services";
import { publicInfo, settle } from "./sign-in-doubles";

export const LAN = "http://192.168.1.5:8096";
export const LOOPBACK = "http://127.0.0.1:8096";
export const SERVER_ID = "0123456789abcdef0123456789abcdef";
export const SECRET = "0123456789abcdef".repeat(4);
export const NEW_SECRET = "fedcba9876543210".repeat(4);
export const CODE = "482913";
export const NEW_CODE = "731205";
export const PLANTED_TOKEN = "planted-fake-access-token-9f3a";
export const PLANTED_PASSWORD = "planted-fake-password-77c1";
export const INTERVAL = 5_000;

export const COPY = {
  heading: "Approve this sign-in on your phone",
  scan: "Scan the code with your phone, or enter the code in Quick Connect.",
  noLink: (address: string) => `On your phone, open ${address} and enter this code in Quick Connect.`,
  expired: "This code has expired. Get a new code to try again.",
  refused: "The server didn't accept this code. Get a new code to try again.",
  unreachable: (address: string) => `Couldn't reach ${address}. Check the address and that the server is running.`,
  redirect: "The server answered with a redirect, which Octave does not follow. Enter the server's final address instead.",
  other: "Something went wrong. Try again.",
  loading: "Loading…",
} as const;

export const ENABLED = "GET /QuickConnect/Enabled";
export const INITIATE = "POST /QuickConnect/Initiate";
export const CONNECT = "GET /QuickConnect/Connect";

type Answer = TransportResponse | Error | Promise<TransportResponse>;
type SignInAnswer = SignInResult | Error | Promise<SignInResult>;

export const ok = (body: unknown): TransportResponse => ({ status: 200, body });
export const httpStatus = (code: number): TransportResponse => ({ status: code, body: undefined });
export const pending = (): TransportResponse => ok({ Authenticated: false });
export const approved = (): TransportResponse => ok({ Authenticated: true });
/** The Initiate answer, with a planted token and password the step must never carry anywhere. */
export const initiated = (secret: string, code: string): TransportResponse => ok({ Secret: secret, Code: code, Extra: [PLANTED_TOKEN, PLANTED_PASSWORD] });

/** Answers each route from its queue (the last answer repeats). A signed-in read answers an empty list. */
export class QuickConnectTransport implements Transport {
  readonly requests: TransportRequest[] = [];
  readonly signIns: SignInRequest[] = [];
  readonly ended: SessionId[] = [];
  signInAnswer: SignInAnswer = { session: "session-1", userId: "user-1", userName: "Louise" };
  private readonly queues = new Map<string, Answer[]>([
    ["GET /System/Info/Public", [publicInfo(SERVER_ID, "Fixture Server")]],
    [ENABLED, [ok(true)]],
    [INITIATE, [initiated(SECRET, CODE), initiated(NEW_SECRET, NEW_CODE)]],
    [CONNECT, [pending()]],
  ]);

  script(route: string, ...answers: Answer[]): void {
    this.queues.set(route, answers);
  }

  count(route: string): number {
    return this.requests.filter((request) => `${request.method} ${request.path}` === route).length;
  }

  /** Every request and sign-in sent so far. */
  total(): number {
    return this.requests.length + this.signIns.length;
  }

  async request(request: TransportRequest): Promise<TransportResponse> {
    this.requests.push(request);
    const queue = this.queues.get(`${request.method} ${request.path}`);
    if (queue === undefined) {
      if (!("session" in request.target)) throw new TransportError("refused");
      return ok(request.path === "/Items/Latest" ? [] : { Items: [] });
    }
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

  async endSession(session: SessionId): Promise<void> {
    this.ended.push(session);
  }
}

const crypto: Crypto = {
  sha256Hex: async () => "0".repeat(64),
  randomId: () => "11111111-1111-4111-8111-111111111111",
};

export function gatewaysFor(transport: Transport): GatewayFactory {
  return createGatewayFactory({ crypto, transport, installId: async () => "22222222-2222-4222-8222-222222222222" });
}

/** The server as step 1 hands it over: probed, and confirmed when it is unencrypted. */
export async function chooseServer(server: string, transport: Transport): Promise<ChosenServer> {
  const gateway = await gatewaysFor(transport)(server, { confirmations: new MemoryLanHttpConfirmations() });
  await gateway.connect();
  gateway.confirmUnencryptedConnection();
  return { gateway, serverName: "Fixture Server", address: gateway.serverUrl };
}

/** Moves the step's clock and lets what it started reach the screen. */
export async function wait(clock: FakeClock, ms: number): Promise<void> {
  await act(async () => {
    await clock.advance(ms);
  });
  await settle();
}

const isInstance = (node: TestInstance | string): node is TestInstance => typeof node !== "string";
const childViews = (element: TestInstance): TestInstance[] => element.children.filter(isInstance);
const flat = (element: TestInstance) => StyleSheet.flatten(element.props.style as never) as Record<string, unknown>;

/** The width of one module of a QR code `size` modules wide (D6). */
export const moduleWidth = (size: number): number => Math.floor(px(480) / (size + 8));

export const qrStyle = (): Record<string, unknown> => flat(screen.getByTestId("sign-in-qr"));

/** The drawn modules, true for dark, read from the runs of each row. */
export function drawnModules(size: number): boolean[][] {
  const width = moduleWidth(size);
  return childViews(screen.getByTestId("sign-in-qr")).map((row) => {
    const modules: boolean[] = [];
    let previous: unknown;
    for (const run of childViews(row)) {
      const style = flat(run);
      if (style.backgroundColor !== colors.onLight && style.backgroundColor !== colors.text1) throw new Error(`a run has no module colour: ${String(style.backgroundColor)}`);
      if (style.backgroundColor === previous) throw new Error("two neighbouring runs have the same colour, so they were not merged");
      previous = style.backgroundColor;
      const count = Number(style.width) / width;
      if (!Number.isInteger(count) || count < 1) throw new Error(`a run is not a whole number of modules: ${String(style.width)}`);
      modules.push(...Array.from({ length: count }, () => style.backgroundColor === colors.onLight));
    }
    return modules;
  });
}

/** Every prop value of every drawn node, as one string (functions left out). */
export function everyProp(): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(screen.toJSON(), (_key, value: unknown) => {
    if (typeof value === "function") return undefined;
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return undefined;
    seen.add(value);
    return value;
  });
}
