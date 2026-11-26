// Staying signed in at launch (T4-05, docs/specs/T4-05.md D6). The newest stored session is tried, and only it (Q5):
// its server is probed, the session is adopted only when the probe answered with the record's server id at the
// record's origin, and GET /Users/Me decides. Home opens only on a 2xx (Q4). Two 401s are a confirmed revoke: the
// session is ended with one logout and the viewer returns to sign-in on that server (Q3). Anything else is
// `unavailable`, the record kept, and no request carrying the session leaves before the id matched. The probe and the
// validation each get `timeoutMs` through the transport's own deadline, which reads as unreachable when it runs out
// (spec check, note 1); nothing is tried a second time by itself (Q7).
import { serverChoiceFailure, type ServerChoiceFailure } from "../domain/server-choice";
import type { ServerConnection } from "../domain/server-connection";
import type { SessionRestore } from "../ports/transport";
import type { JellyfinGateway } from "./gateway";

export type RestoreOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "signed-in"; readonly gateway: JellyfinGateway; readonly serverName: string }
  | { readonly kind: "sign-in-again"; readonly gateway: JellyfinGateway; readonly connection: ServerConnection; readonly userName?: string }
  | { readonly kind: "unavailable"; readonly address: string; readonly failure: ServerChoiceFailure };

export interface RestoreSessionOptions {
  readonly restore: SessionRestore;
  /** Builds the gateway for a stored server; the host passes the sign-in steps' confirmation store (D6). */
  readonly gateways: (server: string) => Promise<JellyfinGateway>;
  readonly timeoutMs: number;
}

export async function restoreSession({ restore, gateways, timeoutMs }: RestoreSessionOptions, signal?: AbortSignal): Promise<RestoreOutcome> {
  const [newest] = await restore.restoreSessions();
  if (newest === undefined) return { kind: "none" };
  const address = newest.server;
  const unavailable = (error: unknown): RestoreOutcome => ({ kind: "unavailable", address, failure: serverChoiceFailure(error, address) ?? "other" });

  let gateway: JellyfinGateway;
  let connection: ServerConnection;
  try {
    gateway = await gateways(address);
    connection = await gateway.connect(signal, timeoutMs);
    gateway.adopt(newest);
  } catch (error) {
    return unavailable(error);
  }

  let standing: "valid" | "revoked";
  try {
    standing = await gateway.sessionStanding(signal, timeoutMs);
  } catch (error) {
    return unavailable(error);
  }
  if (standing === "valid") return { kind: "signed-in", gateway, serverName: connection.name };

  await gateway.logout();
  return { kind: "sign-in-again", gateway, connection, ...(newest.userName === undefined ? {} : { userName: newest.userName }) };
}
