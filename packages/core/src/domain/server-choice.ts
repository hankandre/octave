// Choosing a server before sign-in (T4-02, DESIGN.md §7.20): which code each failure gets, how a typed address with no
// scheme is completed, and the order of the rows. Pure: it duck-types errors instead of importing ports/.
import { classifyServerAddress } from "./host-class";
import { sameServerId, type DiscoveredServer } from "./server-discovery";
import type { SignInFailureKind } from "./sign-in-failure";

export type ServerChoiceFailure =
  | "unreachable"
  | "refused-plain-http"
  | "unicode-host"
  | "redirect"
  | "unsupported-version"
  | "not-an-address"
  | "not-the-discovered-server"
  | "other";

const PLAIN_HTTP = /^http:\/\//i;
const HTTPS_AUTHORITY = /^https:\/\/([^/?#]*)/i;
const PUNYCODE_LABEL = /^xn--/i;

function hasPunycodeLabel(address: string): boolean {
  const authority = HTTPS_AUTHORITY.exec(address.trim())?.[1];
  return authority?.split(".").some((label) => PUNYCODE_LABEL.test(label)) ?? false;
}

// A native refusal before any request carries no sub-code, so the address says which sentence is true: on plain HTTP
// Octave will not connect (T3-20), and an `xn--` host the native client cannot read is no address (R11).
function refusedFailure(address: string): ServerChoiceFailure {
  if (PLAIN_HTTP.test(address.trim())) return "refused-plain-http";
  return hasPunycodeLabel(address) ? "not-an-address" : "other";
}

function signInKindFailure(kind: SignInFailureKind): ServerChoiceFailure {
  switch (kind) {
    case "invalid-address":
      return "not-an-address";
    case "public-http":
      return "refused-plain-http";
    case "unicode-host":
    case "redirect":
    case "unsupported-version":
      return kind;
    case "unexpected-response":
    case "not-confirmed":
      return "other";
  }
}

function transportFailure(code: unknown, address: string): ServerChoiceFailure | undefined {
  switch (code) {
    case "cancelled":
      return undefined;
    case "network":
    case "timeout":
      return "unreachable";
    case "redirect":
      return "redirect";
    case "refused":
      return refusedFailure(address);
    default:
      return "other";
  }
}

/** The failure's code, read from `kind` or `code` and never from a message. Undefined for a cancellation. */
export function serverChoiceFailure(error: unknown, address: string): ServerChoiceFailure | undefined {
  if (typeof error !== "object" || error === null) return "other";
  const { name, kind, code } = error as { name?: unknown; kind?: unknown; code?: unknown };
  if (name === "SignInFailure") return signInKindFailure(kind as SignInFailureKind);
  if (name === "AbortError") return undefined;
  return transportFailure(code, address);
}

/** A typed address with no scheme gets `http://` for this device or a home-network host, else `https://` (R8). */
export function completeAddress(text: string): string {
  const typed = text.trim();
  if (typed.includes("://")) return typed;
  const plain = `http://${typed}`;
  return classifyServerAddress(plain) === "public" ? `https://${typed}` : plain;
}

export interface RememberedServer {
  readonly id: string;
  readonly name: string;
  readonly address: string;
}

export type ServerRow =
  | { readonly kind: "remembered"; readonly id: string; readonly name: string; readonly address: string }
  | ({ readonly kind: "found" } & DiscoveredServer);

/** Remembered servers first, then the found ones whose id is not remembered (item 7). */
export function listServers(remembered: readonly RememberedServer[], found: readonly DiscoveredServer[]): ServerRow[] {
  const unremembered = found.filter((server) => !remembered.some((known) => sameServerId(server.id, known.id)));
  return [
    ...remembered.map((server): ServerRow => ({ kind: "remembered", ...server })),
    ...unremembered.map((server): ServerRow => ({ kind: "found", ...server })),
  ];
}
