// The pure rules of Quick Connect sign-in (T4-03 D4, D5, D6): the approval link a QR code carries, how the code is
// shown and read, and which failure each answer is. It duck-types errors instead of importing ports/.
import type { HostClass } from "./host-class";

export type QuickConnectFailure = "expired" | "refused" | "unreachable" | "redirect" | "other";

export type QuickConnectStep = "enabled" | "initiate" | "connect" | "sign-in";

export const POLL_INTERVAL_MS = 5_000;
// Jellyfin expires a request this long after Initiate.
export const CODE_LIFETIME_MS = 600_000;
// Polls in a row that must fail to reach the server before the run gives up.
export const UNREACHABLE_POLLS = 3;

const SIX_DIGITS = /^\d{6}$/;

// jellyfin-web's Quick Connect page, which fills its field from `code`. A loopback server is this TV, which a phone
// cannot open, so it has no link.
export function quickConnectApprovalLink(server: { serverUrl: string; hostClass: HostClass }, code: string): string | undefined {
  if (server.hostClass === "loopback") return undefined;
  return `${server.serverUrl}/web/#/quickconnect?code=${encodeURIComponent(code)}`;
}

export function groupCode(code: string): string {
  return SIX_DIGITS.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** The code read digit by digit, so TalkBack does not read it as one number. */
export function spokenCode(code: string): string {
  return [...code].join(" ");
}

function statusFailure(status: unknown, step: QuickConnectStep): QuickConnectFailure {
  if (step !== "connect" && step !== "sign-in") return "other";
  if (status === 404) return "expired";
  return status === 401 || status === 403 ? "refused" : "other";
}

/** Read from `kind`, `code` and `status`, never from a message. Undefined for a cancellation. */
export function quickConnectFailure(error: unknown, step: QuickConnectStep): QuickConnectFailure | undefined {
  if (typeof error !== "object" || error === null) return "other";
  const { name, kind, code, status } = error as { name?: unknown; kind?: unknown; code?: unknown; status?: unknown };
  if (name === "SignInFailure") return kind === "redirect" ? "redirect" : "other";
  if (name === "AbortError") return undefined;
  switch (code) {
    case "cancelled":
      return undefined;
    case "network":
    case "timeout":
      return "unreachable";
    case "redirect":
      return "redirect";
    case "status":
      return statusFailure(status, step);
    default:
      return "other";
  }
}
