// Wire test transport-redirect (T3-05 item 2): the pair's recorder fronts the mock's redirector, whose every answer is
// a 302 to the canary origin with a credential parameter. The transport must report the redirect code, the gateway
// its redirect failure, and the canary origin must see nothing.
import { JellyfinGateway } from "@octave/core/src/jellyfin/gateway";
import { codeOf, outcomeOf, PROBE_DEVICE_ID, UNREACHABLE, type WireContext, type WireOutcome } from "./wire-context";

export async function run({ base, crypto, transport, seam }: WireContext): Promise<WireOutcome> {
  const code = await outcomeOf(
    transport.request({ target: { server: base, deviceId: PROBE_DEVICE_ID }, method: "GET", path: "/System/Info/Public", timeoutMs: 10_000 }),
    seam,
  );
  if (code === "network") return UNREACHABLE;
  let gateway = "ok";
  try {
    seam.add(await new JellyfinGateway(base, crypto, transport).connect());
  } catch (error) {
    seam.add(error);
    gateway = codeOf(error);
  }
  return { words: `code=${code} gateway=${gateway}` };
}
