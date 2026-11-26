// Wire test transport-canary (T3-05 item 4): the mock issues a fixed canary as the token and echoes it in bodies, in a
// 401, a 500 and a redirect. Everything that crosses the seam, and what the gateway returns or throws, is scanned on
// the device; the host then scans the run's whole logcat dump.
//
// T4-05 (item 6, issue 8): restoreSessions is called through the seam after the sign-in and after the logout, so its
// results are scanned too. The test looks for its own session by the id its sign-in returned and asserts nothing about
// the list's length: on a real TV the list may hold the owner's session. No field of a restore result leaves the device;
// the line holds two fixed words, restore= and after-logout=.
import type { JellyfinGateway } from "@octave/core/src/jellyfin/gateway";
import { createSessionRestore } from "../../host/transport";
import { scanSelfTest } from "./seam-recorder";
import { codeOf, UNREACHABLE, type WireContext, type WireOutcome } from "./wire-context";

export async function run({ base, list, transport, seam, gateway: build }: WireContext): Promise<WireOutcome> {
  let gateway: JellyfinGateway;
  try {
    gateway = await build(base);
  } catch (error) {
    seam.add(error);
    return { words: `outcome=gateway-${codeOf(error)}` };
  }
  try {
    seam.add(await gateway.connect());
  } catch (error) {
    seam.add(error);
    if (codeOf(error) === "network") return UNREACHABLE;
  }
  const restore = createSessionRestore(seam.native);
  const lists = async (session: string | undefined): Promise<boolean> => session !== undefined && (await restore.restoreSessions()).some((entry) => entry.session === session);
  let own: string | undefined;
  let restored = "not-run";
  let afterLogout = "not-run";
  try {
    gateway.confirmUnencryptedConnection();
    seam.add(await gateway.login(list.user, list.password));
    own = gateway.sessionId();
    restored = (await lists(own)) ? "listed" : "missing";
    const target = { session: gateway.sessionId() };
    for (const path of ["/Wire/echo", "/Wire/401", "/Wire/500", "/Wire/redirect"]) {
      try {
        seam.add(await transport.request({ target, method: "GET", path, timeoutMs: 10_000 }));
      } catch (error) {
        seam.add(error);
      }
    }
    await gateway.logout();
    afterLogout = (await lists(own)) ? "present" : "absent";
  } catch (error) {
    seam.add(error);
  }
  const canary = seam.holds([list.canary]) ? "present" : "absent";
  return { words: `crossings=${seam.count} selftest=${scanSelfTest(list.canary) ? "ok" : "fail"} canary=${canary} restore=${restored} after-logout=${afterLogout}` };
}
