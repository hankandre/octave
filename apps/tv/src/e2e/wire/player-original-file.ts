// Wire test player-original-file (T8-02 items 1, 2, 4, 7 and 8): the H.264 sample from the pinned Jellyscale, played
// through the Media3 engine over the one client. It reaches loaded then the first frame, pauses and resumes, seeks to
// 6 s, stops, and launches again from 6 s, so the data source opens at a non-zero position and sends a Range header
// whatever was buffered (spec check issue 6). The host judges the capture: the header on every request, ranges
// included, no credential parameter, and only original-file URLs.
import { isOutcome, planFor, planWord, PlayerRig, signIn, STEP_MS } from "./player-run";
import type { WireContext, WireOutcome } from "./wire-context";

const SAMPLE = "Synthetic H264";
const SEEK_SECONDS = 6;

export async function run(context: WireContext): Promise<WireOutcome> {
  const gateway = await signIn(context);
  if (isOutcome(gateway)) return gateway;
  const plan = await planFor(gateway, SAMPLE);
  if (typeof plan === "string") return { words: `outcome=${plan}` };
  const words = [`plan=${planWord(plan)}`];
  if (plan.delivery !== "static") return { words: `outcome=ok ${words.join(" ")}` };

  const rig = await PlayerRig.open(context);
  try {
    const first = await rig.play(gateway, plan);
    const loaded = rig.events.findIndex((event, index) => index >= first.from && event.kind === "loaded");
    const frame = rig.events.findIndex((event, index) => index >= first.from && event.kind === "first-frame");
    words.push(`firstFrame=${first.word !== "first-frame" ? first.word : loaded >= 0 && loaded < frame ? "after-loaded" : "before-loaded"}`);

    words.push(`pause=${await pauseAndResume(rig)}`);
    words.push(`seek=${await seek(rig)}`);
    words.push(`stop=${await rig.stop(first.from)}`);

    const again = await planFor(gateway, SAMPLE, SEEK_SECONDS);
    if (typeof again === "string") {
      words.push(`relaunch=${again}`);
    } else {
      const second = await rig.play(gateway, again);
      words.push(`relaunch=${second.word === "first-frame" ? "ok" : second.word}`);
      await rig.stop(second.from);
    }
    return { words: `outcome=ok ${words.join(" ")}` };
  } finally {
    rig.close();
  }
}

async function pauseAndResume(rig: PlayerRig): Promise<string> {
  for (const paused of [true, false]) {
    const from = rig.events.length;
    try {
      await rig.engine.setPaused(paused);
    } catch {
      return "failed";
    }
    const state = await rig.next((event) => event.kind === "state" && event.cause === "pause" && event.snapshot.paused === paused, STEP_MS, from);
    if (state === undefined) return "timeout";
  }
  return "ok";
}

async function seek(rig: PlayerRig): Promise<string> {
  const from = rig.events.length;
  try {
    await rig.engine.seek(SEEK_SECONDS);
  } catch {
    return "failed";
  }
  const landed = await rig.next((event) => event.kind === "state" && event.cause === "seek" && event.snapshot.positionSeconds >= SEEK_SECONDS - 1, STEP_MS, from);
  return landed === undefined ? "timeout" : "ok";
}
