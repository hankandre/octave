// Wire test player-redirect (T8-02 item 5): the mock answers the item and its PlaybackInfo with one direct-play source
// and answers the stream with a 302 to the canary origin carrying a credential parameter. The one client refuses the
// redirect, so the engine ends in server-error and the canary origin receives nothing; the host counts both.
import { isOutcome, planFor, PlayerRig, signIn } from "./player-run";
import type { WireContext, WireOutcome } from "./wire-context";

export async function run(context: WireContext): Promise<WireOutcome> {
  const gateway = await signIn(context);
  if (isOutcome(gateway)) return gateway;
  const plan = await planFor(gateway, "Synthetic H264");
  if (typeof plan === "string") return { words: `code=${plan}` };
  const rig = await PlayerRig.open(context);
  try {
    const played = await rig.play(gateway, plan);
    await rig.stop(played.from);
    return { words: `code=${played.word}` };
  } finally {
    rig.close();
  }
}
