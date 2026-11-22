// Wire test transport-canary (T3-05 item 4): the mock issues a fixed canary as the token and echoes it in bodies, in a
// 401, a 500 and a redirect. Everything that crosses the seam, and what the gateway returns or throws, is scanned on
// the device; the host then scans the run's whole logcat dump.
import type { JellyfinGateway } from "@octave/core/src/jellyfin/gateway";
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
  try {
    gateway.confirmUnencryptedConnection();
    seam.add(await gateway.login(list.user, list.password));
    const target = { session: gateway.sessionId() };
    for (const path of ["/Wire/echo", "/Wire/401", "/Wire/500", "/Wire/redirect"]) {
      try {
        seam.add(await transport.request({ target, method: "GET", path, timeoutMs: 10_000 }));
      } catch (error) {
        seam.add(error);
      }
    }
    await gateway.logout();
  } catch (error) {
    seam.add(error);
  }
  const canary = seam.holds([list.canary]) ? "present" : "absent";
  return { words: `crossings=${seam.count} selftest=${scanSelfTest(list.canary) ? "ok" : "fail"} canary=${canary}` };
}
