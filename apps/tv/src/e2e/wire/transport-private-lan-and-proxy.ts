// Wire test transport-private-lan-and-proxy (T3-05 item 9). TEST HARNESS ONLY: do not copy this into the app.
//
// It follows an address taken from a server's answer, which app code must never do ("refuse any other origin"). It is
// fenced three ways: it lives under src/e2e/, which reaches no release bundle; it sends only a tokenless pre-sign-in
// route; and privateLanProbeTarget passes nothing but http://10.0.2.2:<port>, the emulator's alias for the host's
// loopback. The request then passes the same address checks as any server address (Kotlin's ServerAddress).
//
// The pair's recorder fronts the mock's private-LAN origin, whose public-info answer gives LocalAddress as
// http://10.0.2.2:<its port>. The test reads it and sends one plain-HTTP GET /System/Info/Public there, straight from
// the release-type app's own process through the one OkHttp client. The origin counts requests whose Host is exactly
// 10.0.2.2:<port>, which a request through adb reverse never carries; the host judge fails the pair without one. The
// global-proxy half of the test is the runner's (scripts/tv-wire.mjs).
import { privateLanProbeTarget } from "./private-lan-address";
import { codeOf, PROBE_DEVICE_ID, UNREACHABLE, type WireContext, type WireOutcome } from "./wire-context";

export async function run({ base, transport, seam }: WireContext): Promise<WireOutcome> {
  const probe = (server: string) =>
    transport.request({ target: { server, deviceId: PROBE_DEVICE_ID }, method: "GET", path: "/System/Info/Public", timeoutMs: 10_000 });
  let answer: unknown;
  try {
    answer = (await probe(base)).body;
    seam.add(answer);
  } catch (error) {
    seam.add(error);
    return codeOf(error) === "network" ? UNREACHABLE : { words: `probe=first-${codeOf(error)}` };
  }
  const address = typeof answer === "object" && answer !== null ? (answer as { LocalAddress?: unknown }).LocalAddress : undefined;
  const target = privateLanProbeTarget(address);
  if (target === null) return { words: "probe=bad-address" };
  try {
    const direct = await probe(target);
    seam.add(direct);
    return { words: direct.status === 200 ? "probe=ok" : `probe=status-${direct.status}` };
  } catch (error) {
    seam.add(error);
    return { words: `probe=${codeOf(error)}` };
  }
}
