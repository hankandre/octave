// Wire test player-samples (T8-02 items 3 and 6): the H.264, HEVC HDR10, AV1 and no-decoder samples from the pinned
// Jellyscale, one launch each, stopped after its outcome. The host judges HEVC and AV1 against the emulator's own
// decoder list. The H.264 play also reports the decoder facts the engine read from Media3.
import type { PlayerEvent } from "@octave/core/src/domain/player-engine";
import { isOutcome, planFor, PlayerRig, signIn } from "./player-run";
import type { WireContext, WireOutcome } from "./wire-context";

const SAMPLES: [string, string][] = [
  ["h264", "Synthetic H264"],
  ["hevc", "Synthetic HEVC HDR10"],
  ["av1", "Synthetic AV1"],
  ["nodecoder", "Synthetic No Decoder"],
];

export async function run(context: WireContext): Promise<WireOutcome> {
  const gateway = await signIn(context);
  if (isOutcome(gateway)) return gateway;
  const rig = await PlayerRig.open(context);
  const words: string[] = [];
  try {
    for (const [key, name] of SAMPLES) {
      const plan = await planFor(gateway, name);
      if (typeof plan === "string") {
        words.push(`${key}=${plan}`);
        continue;
      }
      if (plan.delivery !== "static") {
        words.push(`${key}=plan-${plan.playMethod === "Transcode" ? "transcode" : "direct-stream"}`);
        continue;
      }
      const played = await rig.play(gateway, plan);
      words.push(`${key}=${played.word}`);
      if (key === "h264") {
        const diagnostics = lastDiagnostics(rig.events.slice(played.from));
        words.push(`decode-h264=${diagnostics?.decodeMode ?? "unknown"}`, `label=${diagnostics !== undefined && diagnostics.decodeLabel !== "" ? "present" : "absent"}`);
      }
      await rig.stop(played.from);
    }
    return { words: words.join(" ") };
  } finally {
    rig.close();
  }
}

function lastDiagnostics(events: PlayerEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if ((event.kind === "state" || event.kind === "loaded") && event.snapshot.diagnostics.decodeLabel !== "") return event.snapshot.diagnostics;
  }
  return undefined;
}
