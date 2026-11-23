import { describe, expect, it } from "vitest";
import type { DeviceCapabilities } from "../domain/device-capabilities";
import { judgeConversion } from "./conversion-device-check";
import {
  capabilities,
  EAC3_PASSTHROUGH,
  NO_AV1_EVERY_AUDIO,
  NO_H264,
  NO_HEVC_NO_H264,
  rewriteUrl,
  SMALL_H264,
  t823Answer,
  withStreamCodec,
} from "./conversion-device-test-support";
import { EVERYTHING, FAILED, recorded, SERVER, VERSIONS, withoutAac, withoutH264, withoutHevc } from "./device-test-support";
import { selectSource, type SourceContext, type SourceDecision } from "./source-acceptance";
import type { PlaybackInfoResponse } from "./types";

// T8-23 items 1 and 2: the verdict on a conversion answer (spec "The verdict (judgeConversion)", with the Product
// Owner's rewrite of D5), from recorded answers.
type Convert = Extract<SourceDecision, { kind: "convert" }>;

function contextOf(answer: PlaybackInfoResponse, itemId: string, caps: DeviceCapabilities): SourceContext {
  return { serverUrl: SERVER, itemId, playSessionId: answer.PlaySessionId, capabilities: caps };
}

// The convert decision the answer becomes today, and the verdict on it.
function judge(answer: PlaybackInfoResponse, itemId: string, caps: DeviceCapabilities, forced = false): { decision: Convert; verdict: SourceDecision } {
  const context = contextOf(answer, itemId, caps);
  const decision = selectSource(answer.MediaSources, context, answer.MediaSources?.[0]?.Id ?? undefined);
  if (decision.kind !== "convert") throw new Error(`the recorded answer is ${decision.kind}, not a conversion`);
  return { decision, verdict: judgeConversion(decision, context, { forced }) };
}

const TARGET = { kind: "refused", reason: "device-cannot-play", detail: "conversion target not playable" };
const COPIED = { kind: "refused", reason: "device-cannot-play", detail: "copied stream not playable" };

describe.each(VERSIONS)("T8-23 item 1: a first answer's conversion from Jellyfin %s is judged", (version) => {
  const limited = () => recorded(version, "conversion-h264-limited");

  it('accepts it unchanged on "full"', () => {
    const { decision, verdict } = judge(limited(), "item-h264", "full");
    expect(verdict).toEqual(decision);
  });

  it("accepts it when the target decodes and every possible copy plays", () => {
    const { decision, verdict } = judge(limited(), "item-h264", EVERYTHING);
    expect(verdict).toEqual(decision);
  });

  it("refuses at once when the device cannot decode the encode target (H.264, the first of the URL's list)", () => {
    expect(judge(limited(), "item-h264", NO_H264).verdict).toEqual(TARGET);
  });

  it("asks for the forced conversion when a possible copy of the video is not playable (the sample is H.264 High)", () => {
    const { verdict } = judge(limited(), "item-h264", withoutH264);
    expect(verdict).toMatchObject({ kind: "force-conversion", cannotPlay: { video: true, audio: false } });
    expect((verdict as { source: { Id: string } }).source.Id).toBe("item-h264");
  });

  it("asks for the forced conversion naming both copies under a failed probe, and judges no target", () => {
    expect(judge(limited(), "item-h264", FAILED).verdict).toMatchObject({ kind: "force-conversion", cannotPlay: { video: true, audio: true } });
  });

  it("judges the target before the copy: a list without aac refuses even though the video copy also fails", () => {
    const list = capabilities([{ codec: "h264", profile: "Constrained Baseline" }], ["ac3"]);
    expect(judge(limited(), "item-h264", list).verdict).toEqual(TARGET);
    expect(judge(limited(), "item-h264", withoutAac).verdict).toEqual(TARGET);
  });

  it("reads the HEVC fallback answer the same way: a possible hevc copy on a list without hevc needs the forced conversion", () => {
    const answer = t823Answer(version, "conversion-hevc-hdr10-force-fallback");
    expect(judge(answer, "item-hevc", withoutHevc).verdict).toMatchObject({ kind: "force-conversion", cannotPlay: { video: true, audio: false } });
    expect(judge(answer, "item-hevc", EVERYTHING).verdict.kind).toBe("convert");
  });

  it("judges a disc's fallback answer (the ISO lists H.264 High and ac3)", () => {
    const answer = recorded(version, "conversion-iso-force-fallback");
    expect(judge(answer, "item-iso", EVERYTHING).verdict.kind).toBe("convert");
    expect(judge(answer, "item-iso", withoutH264).verdict).toMatchObject({ kind: "force-conversion", cannotPlay: { video: true, audio: false } });
    expect(judge(answer, "item-iso", capabilities([{ codec: "h264" }], ["aac"])).verdict).toMatchObject({ kind: "force-conversion", cannotPlay: { video: false, audio: true } });
  });
});

describe.each(VERSIONS)("T8-23 item 1: what a copy can be, on Jellyfin %s (PO ruling on D5)", (version) => {
  it("counts no copy of a source codec outside the URL's list: the no-decoder sample sends no forced request when the target decodes", () => {
    const answer = t823Answer(version, "encode-target-no-decoder");
    expect(answer.MediaSources![0].MediaStreams!.find((stream) => stream.Type === "Video")!.Codec).toBe("msmpeg4v3");
    const { decision, verdict } = judge(answer, "item-no-decoder", EVERYTHING);
    expect(verdict).toEqual(decision);
  });

  it("still asks under a failed probe for the audio copy the list allows (aac is in the list)", () => {
    const answer = t823Answer(version, "encode-target-no-decoder");
    expect(judge(answer, "item-no-decoder", FAILED).verdict).toMatchObject({ kind: "force-conversion", cannotPlay: { video: false, audio: true } });
  });

  it("counts no copy of an audio codec outside the list (DTS, rewritten; unverified by a recording)", () => {
    const answer = withStreamCodec(recorded(version, "conversion-h264-limited"), 1, "dts");
    const { decision, verdict } = judge(answer, "item-h264", EVERYTHING);
    expect(verdict).toEqual(decision);
  });

  it("counts no copy the URL turns off", () => {
    const answer = rewriteUrl(recorded(version, "conversion-h264-limited"), /&TranscodeReasons=/, "&AllowVideoStreamCopy=false&TranscodeReasons=");
    expect(judge(answer, "item-h264", withoutH264).verdict.kind).toBe("convert");
  });

  it("matches the parameter names and the copy flag in any case", () => {
    const lower = rewriteUrl(recorded(version, "conversion-h264-limited"), /VideoCodec=/, "videocodec=");
    expect(judge(lower, "item-h264", NO_H264).verdict).toEqual(TARGET);
    expect(judge(lower, "item-h264", withoutH264).verdict).toMatchObject({ kind: "force-conversion" });
    const shouting = rewriteUrl(recorded(version, "conversion-h264-limited"), /&TranscodeReasons=/, "&ALLOWVIDEOSTREAMCOPY=FALSE&TranscodeReasons=");
    expect(judge(shouting, "item-h264", withoutH264).verdict.kind).toBe("convert");
  });

  it("treats a missing video list as cannot tell: never playable", () => {
    const answer = rewriteUrl(recorded(version, "conversion-h264-limited"), /VideoCodec=[^&]*&/, "");
    expect(judge(answer, "item-h264", EVERYTHING).verdict).toMatchObject({ kind: "refused", reason: "device-cannot-play" });
  });
});

describe("T8-23 item 1: the pinned Jellyscale's two VideoCodec forms (PO ruling on D5)", () => {
  const limited = () => t823Answer("jellyscale", "encode-target-h264-limited");

  it("reads VideoCodec=h264 as an encode into H.264: refused on a list with no h264 decoder", () => {
    expect(new URL(limited().MediaSources![0].TranscodingUrl!, SERVER).searchParams.get("VideoCodec")).toBe("h264");
    expect(judge(limited(), "item-h264", NO_H264).verdict).toEqual(TARGET);
    expect(judge(limited(), "item-h264", EVERYTHING).verdict.kind).toBe("convert");
  });

  it("asks for the forced conversion when the H.264 High copy is possible and not playable", () => {
    expect(judge(limited(), "item-h264", withoutH264).verdict).toMatchObject({ kind: "force-conversion", cannotPlay: { video: true } });
  });

  it("reads VideoCodec=copy (any case) as a copy of the source's video, with no video target to judge (rewritten; unverified by a recording)", () => {
    for (const form of ["copy", "COPY", "Copy"]) {
      const copying = rewriteUrl(limited(), /VideoCodec=h264/, `VideoCodec=${form}`);
      // No h264 decoder at all: a target rule would refuse; the copy rule asks for the forced conversion instead.
      expect(judge(copying, "item-h264", NO_H264).verdict, form).toMatchObject({ kind: "force-conversion", cannotPlay: { video: true } });
      expect(judge(copying, "item-h264", withoutH264).verdict, form).toMatchObject({ kind: "force-conversion", cannotPlay: { video: true } });
      expect(judge(copying, "item-h264", EVERYTHING).verdict.kind, form).toBe("convert");
    }
  });
});

describe.each(VERSIONS)("T8-23 item 1: a source with no probed streams (the Blu-ray folder on Jellyfin %s, D4)", (version) => {
  const folder = () => t823Answer(version, "conversion-bluray-folder");

  it("has no streams to judge", () => {
    expect(folder().MediaSources![0].MediaStreams ?? []).toEqual([]);
  });

  it("accepts when the device decodes every codec the URL lists, audio by decoder or passthrough", () => {
    expect(judge(folder(), "item-bluray", EVERYTHING).verdict.kind).toBe("convert");
    expect(judge(folder(), "item-bluray", EAC3_PASSTHROUGH).verdict.kind).toBe("convert");
  });

  it("asks for the forced conversion when one listed codec has no decoder", () => {
    expect(judge(folder(), "item-bluray", NO_AV1_EVERY_AUDIO).verdict).toMatchObject({ kind: "force-conversion", cannotPlay: { video: true, audio: false } });
    const noEac3 = capabilities([{ codec: "h264" }, { codec: "hevc" }, { codec: "av1" }, { codec: "vp9" }], ["aac", "ac3", "opus", "flac", "mp3"]);
    expect(judge(folder(), "item-bluray", noEac3).verdict).toMatchObject({ kind: "force-conversion", cannotPlay: { video: false, audio: true } });
  });

  it("judges no limit, for there is no value to compare", () => {
    const small = capabilities([{ codec: "h264", maxWidth: 320, maxHeight: 180, maxBitDepth: 8 }, { codec: "hevc" }, { codec: "av1" }, { codec: "vp9" }], ["aac", "ac3", "eac3", "opus", "flac", "mp3"]);
    expect(judge(folder(), "item-bluray", small).verdict.kind).toBe("convert");
  });
});

describe.each(VERSIONS)("T8-23 item 2: the forced answer from Jellyfin %s is judged", (version) => {
  const forced = () => recorded(version, "device-conversion-hevc-hdr10");

  it("refuses an encode target the device cannot decode: a list with neither hevc nor h264", () => {
    expect(judge(forced(), "item-hevc", NO_HEVC_NO_H264, true).verdict).toEqual(TARGET);
  });

  it("refuses a target larger than the h264 decoder's limit (the HEVC sample is 1280x720)", () => {
    expect(judge(forced(), "item-hevc", SMALL_H264, true).verdict).toEqual(TARGET);
  });

  it("lowers the target's size by the URL's MaxWidth and MaxHeight", () => {
    const answer = rewriteUrl(forced(), /&TranscodeReasons=/, "&MaxWidth=640&MaxHeight=360&TranscodeReasons=");
    expect(judge(answer, "item-hevc", SMALL_H264, true).verdict.kind).toBe("convert");
  });

  it("lowers the target's frame rate by the URL's MaxFramerate", () => {
    const slow = capabilities([{ codec: "h264", maxFrameRate: 24 }], ["aac"]);
    expect(judge(forced(), "item-hevc", slow, true).verdict.kind).toBe("convert");
    const slower = capabilities([{ codec: "h264", maxFrameRate: 12 }], ["aac"]);
    expect(judge(forced(), "item-hevc", slower, true).verdict).toEqual(TARGET);
    const halved = rewriteUrl(forced(), /MaxFramerate=24/, "MaxFramerate=12");
    expect(judge(halved, "item-hevc", slower, true).verdict.kind).toBe("convert");
  });

  it("does not judge the target's profile, bit depth or level", () => {
    const list = capabilities([{ codec: "h264", profile: "Constrained Baseline", maxBitDepth: 8, maxLevel: 10 } as never], ["aac"]);
    expect(judge(forced(), "item-hevc", list, true).verdict.kind).toBe("convert");
  });

  it("accepts the answer when the target decodes and the copy left on plays", () => {
    const { decision, verdict } = judge(forced(), "item-hevc", withoutHevc, true);
    expect(verdict).toEqual(decision);
  });

  it("refuses a copy still possible and not playable with the client-side detail", () => {
    // The recorded limited conversion copies the H.264 High video; judged as a forced answer, it is not re-encoded.
    expect(judge(recorded(version, "conversion-h264-limited"), "item-h264", withoutH264, true).verdict).toEqual(COPIED);
    // The forced answer leaves the audio copy on; an audio codec the list holds and the device cannot play (eac3,
    // rewritten) is a copy the device cannot play.
    const eac3 = withStreamCodec(forced(), 1, "eac3");
    expect(judge(eac3, "item-hevc", withoutHevc, true).verdict).toEqual(COPIED);
  });

  it("never asks again: a forced answer is accepted or refused", () => {
    for (const caps of [NO_HEVC_NO_H264, SMALL_H264, withoutHevc, withoutH264, EVERYTHING]) {
      expect(["convert", "refused"]).toContain(judge(forced(), "item-hevc", caps, true).verdict.kind);
    }
  });

  it("accepts the disc's forced answer, which copies nothing, under a failed probe without judging its target", () => {
    const answer = t823Answer(version, "device-disc-conversion-iso");
    const { decision, verdict } = judge(answer, "item-iso", FAILED, true);
    expect(verdict).toEqual(decision);
    const folder = t823Answer(version, "device-disc-conversion-bluray-folder");
    expect(judge(folder, "item-bluray", FAILED, true).verdict.kind).toBe("convert");
  });

  it('accepts on "full" with nothing judged', () => {
    const { decision, verdict } = judge(forced(), "item-hevc", "full", true);
    expect(verdict).toEqual(decision);
  });
});
