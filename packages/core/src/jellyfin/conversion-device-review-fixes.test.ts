import { describe, expect, it } from "vitest";
import type { DeviceCapabilities } from "../domain/device-capabilities";
import type { PlaybackPlan } from "../domain/playback";
import { judgeConversion } from "./conversion-device-check";
import { capabilities, rewriteUrl, SMALL_H264, t823Answer } from "./conversion-device-test-support";
import { negotiate, queryValue, recorded, SERVER, VERSIONS, withoutH264, withSession } from "./device-test-support";
import { selectSource, type SourceDecision } from "./source-acceptance";
import type { PlaybackInfoResponse } from "./types";

// T8-23 review fixes: the forced request's audio flag on the plain-answer path (D11), a copy the device plays is not
// refused for its target (D12), and the target keeps the source's aspect ratio under one size limit.
const FORCED = "play-session-forced";
const TARGET = { kind: "refused", reason: "device-cannot-play", detail: "conversion target not playable" };

function verdictOf(answer: PlaybackInfoResponse, itemId: string, caps: DeviceCapabilities, forced = false): SourceDecision {
  const context = { serverUrl: SERVER, itemId, playSessionId: answer.PlaySessionId, capabilities: caps };
  const decision = selectSource(answer.MediaSources, context, answer.MediaSources?.[0]?.Id ?? undefined);
  if (decision.kind !== "convert") throw new Error(`the recorded answer is ${decision.kind}, not a conversion`);
  return judgeConversion(decision, context, { forced });
}

// H.264 decodes only as Constrained Baseline (so the samples' H.264 High cannot play) and no ac3 decoder.
const NO_HIGH_NO_AC3 = capabilities([{ codec: "h264", profile: "Constrained Baseline" }, { codec: "hevc" }, { codec: "av1" }], ["aac"]);

describe.each(VERSIONS)("T8-23 review: the forced request after a refused first answer and a plain direct-play answer on Jellyfin %s", (version) => {
  const request = { mediaSourceId: "item-multitrack", options: { audioStreamIndex: 2, keepDirectPlay: true } };
  const answers = () => {
    const refused = recorded(version, "conversion-multitrack-audio-pick");
    refused.MediaSources![0].SupportsDirectPlay = false;
    refused.MediaSources![0].SupportsTranscoding = false;
    return [refused, recorded(version, "conversion-multitrack"), withSession(recorded(version, "device-conversion-multitrack-audio"), FORCED)];
  };

  it("turns the audio copy off when the picked track the forced request carries cannot play", async () => {
    const { transport, result } = await negotiate("item-multitrack", answers(), NO_HIGH_NO_AC3, request);
    expect(transport.posts).toHaveLength(3);
    const forced = transport.posts[2];
    expect(forced.data).toMatchObject({ AudioStreamIndex: 2, AllowVideoStreamCopy: false, AllowAudioStreamCopy: false });
    expect(queryValue(forced, "AllowAudioStreamCopy")).toBe("false");
    expect((result as PlaybackPlan).playSessionId).toBe(FORCED);
  });

  it("leaves the audio copy on when the picked track plays", async () => {
    const { transport } = await negotiate("item-multitrack", answers(), withoutH264, request);
    expect(transport.posts).toHaveLength(3);
    expect(transport.posts[2].data).toMatchObject({ AudioStreamIndex: 2, AllowVideoStreamCopy: false, AllowAudioStreamCopy: true });
    expect(queryValue(transport.posts[2], "AllowAudioStreamCopy")).toBe("true");
  });
});

describe.each(VERSIONS)("T8-23 review: a possible copy the device plays is not refused for its target on Jellyfin %s (D12)", (version) => {
  const fallback = () => t823Answer(version, "conversion-hevc-hdr10-force-fallback");
  // Plays the HEVC sample (1280x720); its h264 decoder cannot take the 1280x720 H.264 target.
  const hevcAndSmallH264 = capabilities([{ codec: "h264", maxWidth: 640, maxHeight: 360 }, { codec: "hevc" }], ["aac"]);

  it("accepts the HEVC fallback answer, which may copy the HEVC the device plays, though the H.264 target is too large", () => {
    expect(verdictOf(fallback(), "item-hevc", hevcAndSmallH264).kind).toBe("convert");
  });

  it("still refuses the target when that copy is turned off", () => {
    const off = rewriteUrl(fallback(), /&TranscodeReasons=/, "&AllowVideoStreamCopy=false&TranscodeReasons=");
    expect(verdictOf(off, "item-hevc", hevcAndSmallH264)).toEqual(TARGET);
  });

  it("still refuses the target when the device cannot play the copy", () => {
    expect(verdictOf(fallback(), "item-hevc", SMALL_H264)).toEqual(TARGET);
  });
});

describe.each(VERSIONS)("T8-23 review: the target keeps the source's aspect ratio under one size limit on Jellyfin %s", (version) => {
  const forced = () => recorded(version, "device-conversion-hevc-hdr10");

  it("scales the height with a MaxWidth alone (1280x720 under MaxWidth=640 is 640x360)", () => {
    const answer = rewriteUrl(forced(), /&TranscodeReasons=/, "&MaxWidth=640&TranscodeReasons=");
    expect(verdictOf(answer, "item-hevc", SMALL_H264, true).kind).toBe("convert");
  });

  it("scales the width with a MaxHeight alone (1280x720 under MaxHeight=360 is 640x360)", () => {
    const answer = rewriteUrl(forced(), /&TranscodeReasons=/, "&MaxHeight=360&TranscodeReasons=");
    expect(verdictOf(answer, "item-hevc", SMALL_H264, true).kind).toBe("convert");
  });

  it("still refuses a target the limit leaves larger than the decoder (MaxWidth=960 is 960x540)", () => {
    const answer = rewriteUrl(forced(), /&TranscodeReasons=/, "&MaxWidth=960&TranscodeReasons=");
    expect(verdictOf(answer, "item-hevc", SMALL_H264, true)).toEqual(TARGET);
  });
});
