// The probe of a chosen server (T4-02 D5): it builds the gateway, which refuses a bad address before any request, then
// sends the one tokenless public-info request. It never reads an error's message.
import { serverChoiceFailure, type ServerChoiceFailure } from "../domain/server-choice";
import type { ServerConnection } from "../domain/server-connection";
import { sameServerId } from "../domain/server-discovery";
import type { JellyfinGateway } from "./gateway";

export type ProbeCandidate = { readonly address: string; readonly discoveredId?: string };

export type ProbeOutcome =
  | { kind: "chosen"; gateway: JellyfinGateway; connection: ServerConnection }
  | { kind: "confirm"; gateway: JellyfinGateway; connection: ServerConnection }
  | { kind: "failed"; failure: ServerChoiceFailure }
  | { kind: "cancelled" };

const CANCELLED: ProbeOutcome = { kind: "cancelled" };

async function ask(open: Open, candidate: ProbeCandidate, signal: AbortSignal): Promise<ProbeOutcome> {
  let address = candidate.address;
  try {
    const gateway = await open(candidate.address);
    // A gateway that arrives after the abort is discarded; it holds no session.
    if (signal.aborted) return CANCELLED;
    address = gateway.serverUrl;
    const connection = await gateway.connect(signal);
    if (signal.aborted) return CANCELLED;
    // Before any confirmation, so a spoofed discovery reply never reaches the dialog.
    if (candidate.discoveredId !== undefined && !sameServerId(candidate.discoveredId, connection.id)) {
      return { kind: "failed", failure: "not-the-discovered-server" };
    }
    return { kind: connection.needsUnencryptedConfirmation ? "confirm" : "chosen", gateway, connection };
  } catch (error) {
    const failure = serverChoiceFailure(error, address);
    if (signal.aborted || failure === undefined) return CANCELLED;
    return { kind: "failed", failure };
  }
}

type Open = (address: string) => Promise<JellyfinGateway>;

/** Resolves `cancelled` as soon as the signal aborts, even while `open` is still pending. */
export function probeServer(open: Open, candidate: ProbeCandidate, signal: AbortSignal): Promise<ProbeOutcome> {
  if (signal.aborted) return Promise.resolve(CANCELLED);
  return new Promise((resolve) => {
    const cancel = () => resolve(CANCELLED);
    signal.addEventListener("abort", cancel, { once: true });
    void ask(open, candidate, signal).then((outcome) => {
      signal.removeEventListener("abort", cancel);
      resolve(outcome);
    });
  });
}
