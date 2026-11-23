// Wire test player-capabilities (T8-07 items 1, 2, 3, 6, 7 and 8): the app's own gateway, whose source decision reads
// the device probe. It reports what the probe answered, plays Synthetic H264 to its first frame (one PlaybackInfo, an
// original-file plan), and negotiates Synthetic No Decoder, whose MS-MPEG-4 v3 video has no decoder on the device, so
// the core sends the one forced-conversion request. The converted plan is negotiated, not played: an HLS launch is
// T8-08's, and the host fails the run on any fetch of it. Words are fixed words only.
import type { LibraryItem } from "@octave/core/src/domain/catalog";
import { PlaybackRefusedError, type PlaybackPlan } from "@octave/core/src/domain/playback";
import type { PlayerCapabilities } from "@octave/core/src/domain/player-engine";
import type { JellyfinGateway } from "@octave/core/src/jellyfin/gateway";
import { isOutcome, planWord, PlayerRig, signIn } from "./player-run";
import { codeOf, type WireContext, type WireOutcome } from "./wire-context";

// Each sample's exact titles: Jellyscale drops the NFO's year, Jellyfin keeps it (Product Owner ruling on item 6). A
// movie matches only one of these exactly; no prefix and no pattern.
const DIRECT = ["Synthetic H264", "Synthetic H264 (2024)"];
const NO_DECODER = ["Synthetic No Decoder", "Synthetic No Decoder (2024)"];
const WORD = /^[A-Za-z-]+$/;

export async function run(context: WireContext): Promise<WireOutcome> {
  const gateway = await signIn(context);
  if (isOutcome(gateway)) return gateway;
  const rig = await PlayerRig.open(context);
  try {
    const words = [
      `probe=${rig.capabilities.probe}`,
      `h264main=${listsMain(rig.capabilities, "h264")}`,
      `hevcmain=${listsMain(rig.capabilities, "hevc")}`,
    ];

    const plan = await planForSample(gateway, DIRECT);
    if (typeof plan === "string") {
      words.push(`h264plan=${plan}`);
    } else {
      words.push(`h264plan=${planWord(plan)}`);
      if (plan.delivery === "static") {
        const played = await rig.play(gateway, plan);
        words.push(`h264=${played.word}`);
        await rig.stop(played.from);
      }
    }

    words.push(await negotiateNoDecoder(context, gateway));
    return { words: `outcome=ok ${words.join(" ")}` };
  } finally {
    rig.close();
  }
}

// An h264 or hevc entry that plays an 8-bit Main source: profile Main, or no profile.
function listsMain(capabilities: PlayerCapabilities, codec: "h264" | "hevc"): "listed" | "absent" {
  if (capabilities.probe !== "complete") return "absent";
  const found = capabilities.videoDecoders.some((decoder) => decoder.codec === codec && (decoder.profile === undefined || decoder.profile === "Main"));
  return found ? "listed" : "absent";
}

// The no-decoder sample's words. planForSample turns every error into plan-<code>, which loses a refusal's reason, so this
// catches its own. The plan is never handed to the rig.
async function negotiateNoDecoder(context: WireContext, gateway: JellyfinGateway): Promise<string> {
  let plan: PlaybackPlan;
  try {
    const item = await findSample(gateway, NO_DECODER);
    if (item === undefined) return "nodecoder=not-found";
    plan = await gateway.createPlaybackPlan(item, 0);
  } catch (error) {
    context.seam.add(error);
    if (error instanceof PlaybackRefusedError) return `nodecoder=refused reason=${WORD.test(error.reason) ? error.reason : "unknown"}`;
    return `nodecoder=plan-${codeOf(error)}`;
  }
  if (plan.delivery === "static") return "nodecoder=original";
  const client = plan.clientConversionReason !== undefined && WORD.test(plan.clientConversionReason) ? plan.clientConversionReason : "none";
  return `nodecoder=${planWord(plan)} client=${client}`;
}

// The movie whose title is exactly one of `titles`. The search uses the first title, which every spelling starts with.
async function findSample(gateway: JellyfinGateway, titles: readonly string[]): Promise<LibraryItem | undefined> {
  const page = await gateway.searchItems(titles[0], { startIndex: 0, limit: 20 });
  const card = page.cards.find((entry) => titles.includes(entry.title) && entry.kind === "Movie");
  return card === undefined ? undefined : { id: card.id, name: card.title, type: "Movie", resumePositionTicks: 0, played: false };
}

// The direct sample's plan from its start, or not-found or plan-<code>.
async function planForSample(gateway: JellyfinGateway, titles: readonly string[]): Promise<PlaybackPlan | string> {
  try {
    const item = await findSample(gateway, titles);
    if (item === undefined) return "not-found";
    return await gateway.createPlaybackPlan(item, 0);
  } catch (error) {
    return `plan-${codeOf(error)}`;
  }
}
