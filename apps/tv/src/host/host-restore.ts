// The wired restore at launch (T4-05 D6): the session module's restoreSessions through createSessionRestore, and a
// gateway for the stored server over the sign-in steps' own confirmation store, so a confirmation given on the way back
// to sign-in (D8) is the one the steps read. Device-only, like ./host-gateway.ts; restoreSession is tested under Node.
import { restoreSession, type RestoreOutcome } from "@octave/core/src/jellyfin/restore-session";
import { hostGateway } from "./host-gateway";
import { hostSignInServices } from "./host-sign-in";
import { loadSessionModule } from "./session-module";
import { createSessionRestore } from "./transport";

/** The probe and the validation each get this long (Q7). */
export const RESTORE_TIMEOUT_MS = 5_000;

export function hostRestore(): Promise<RestoreOutcome> {
  return restoreSession({
    restore: createSessionRestore(loadSessionModule()),
    gateways: (server) => hostGateway(server, { confirmations: hostSignInServices.confirmations }),
    timeoutMs: RESTORE_TIMEOUT_MS,
  });
}
