import { describe, expect, it } from "vitest";
import { PlaybackRefusedError, type PlaybackPlan } from "../domain/playback";
import {
  AAC_ONE_CHANNEL,
  capabilities,
  NO_AV1_EVERY_AUDIO,
  NO_H264,
  NO_HEVC_NO_H264,
  OPUS_ONLY,
  rewriteUrl,
  SMALL_H264,
  t823Answer,
  withStreamCodec,
} from "./conversion-device-test-support";
import { EVERYTHING, FAILED, negotiate, queryValue, recorded, VERSIONS, withoutAc3, withoutH264, withoutHevc, withSession, type Post } from "./device-test-support";

// T8-23 items 1, 2 and 4 through the gateway's negotiation (spec "Requests", Test plan 4, and the Product Owner's
// conditions on T8-23's own tests), replayed from recorded answers of Jellyfin 10.11.7 and 12.4.0 and the pinned
// Jellyscale.
const FORCED = "play-session-forced";
const TARGET = { reason: "device-cannot-play", detail: "conversion target not playable" };

function planOf(result: unknown): PlaybackPlan {
  if (result instanceof Error) throw result;
  return result as PlaybackPlan;
}

function refusalOf(result: unknown): PlaybackRefusedError {
  expect(result).toBeInstanceOf(PlaybackRefusedError);
  return result as PlaybackRefusedError;
}

// The forced request: direct play and video copy off, in body and query, the audio flag as given, the source named.
function expectForced(post: Post, audioCopy: boolean, mediaSourceId: string) {
  expect(post.data).toMatchObject({ EnableDirectPlay: false, AllowVideoStreamCopy: false, AllowAudioStreamCopy: audioCopy, MediaSourceId: mediaSourceId });
  expect(queryValue(post, "EnableDirectPlay")).toBe("false");
  expect(queryValue(post, "AllowVideoStreamCopy")).toBe("false");
  expect(queryValue(post, "AllowAudioStreamCopy")).toBe(String(audioCopy));
}

// A disc's fallback: direct play off, both copies left on.
function expectDiscFallback(post: Post) {
  expect(post.data).toMatchObject({ EnableDirectPlay: false, AllowVideoStreamCopy: true, AllowAudioStreamCopy: true });
  expect(queryValue(post, "AllowVideoStreamCopy")).toBe("true");
}

function expectForcedPlan(plan: PlaybackPlan, itemId: string) {
  expect(plan).toMatchObject({ delivery: "hls", mediaSourceId: itemId, playSessionId: FORCED, clientConversionReason: "DeviceCannotPlay", playOriginalAvailable: false });
  expect(new URL(plan.streamUrl).pathname).toBe(`/videos/${itemId}/master.m3u8`);
}

describe.each(VERSIONS)("T8-23 item 1: a first answer's conversion from Jellyfin %s", (version) => {
  it("asks once for the forced conversion when the recorded HEVC fallback, as a first answer, may copy hevc on a list without hevc", async () => {
    const answers = [t823Answer(version, "conversion-hevc-hdr10-force-fallback"), withSession(recorded(version, "device-conversion-hevc-hdr10"), FORCED)];
    const { transport, result } = await negotiate("item-hevc", answers, withoutHevc);
    expect(transport.posts).toHaveLength(2);
    expectForced(transport.posts[1], true, "item-hevc");
    expectForcedPlan(planOf(result), "item-hevc");
  });

  it("refuses conversion-h264-limited with one request on a list with no h264 decoder (the target is H.264)", async () => {
    const { transport, result } = await negotiate("item-h264", [recorded(version, "conversion-h264-limited")], NO_H264);
    expect(refusalOf(result)).toMatchObject(TARGET);
    expect(transport.posts).toHaveLength(1);
  });

  it("sends the forced request for conversion-h264-limited on the list that cannot play H.264 High, two requests", async () => {
    const answers = [recorded(version, "conversion-h264-limited"), withSession(recorded(version, "device-conversion-h264"), FORCED)];
    const { transport, result } = await negotiate("item-h264", answers, withoutH264);
    expect(transport.posts).toHaveLength(2);
    expectForced(transport.posts[1], true, "item-h264");
    expectForcedPlan(planOf(result), "item-h264");
  });

  it("sends no forced request for the no-decoder sample, whose codec the URL's list does not hold, when the target decodes", async () => {
    const { transport, result } = await negotiate("item-no-decoder", [t823Answer(version, "encode-target-no-decoder")], EVERYTHING);
    expect(transport.posts).toHaveLength(1);
    expect(planOf(result)).toMatchObject({ delivery: "hls", mediaSourceId: "item-no-decoder" });
    expect(planOf(result)).not.toHaveProperty("clientConversionReason");
  });
});

describe.each(VERSIONS)("T8-23 item 1: a disc's forced fallback from Jellyfin %s", (version) => {
  const iso = () => [recorded(version, "conversion-iso"), recorded(version, "conversion-iso-force-fallback"), withSession(t823Answer(version, "device-disc-conversion-iso"), FORCED)];

  it("sends the forced request third for the ISO on a list without ac3, with audio copy off", async () => {
    const { transport, result } = await negotiate("item-iso", iso(), withoutAc3);
    expect(transport.posts).toHaveLength(3);
    expectDiscFallback(transport.posts[1]);
    expectForced(transport.posts[2], false, "item-iso");
    expectForcedPlan(planOf(result), "item-iso");
  });

  it("sends the forced request third for the ISO on the list that cannot play H.264 High, with audio copy on", async () => {
    const { transport, result } = await negotiate("item-iso", iso(), withoutH264);
    expect(transport.posts).toHaveLength(3);
    expectDiscFallback(transport.posts[1]);
    expectForced(transport.posts[2], true, "item-iso");
    expectForcedPlan(planOf(result), "item-iso");
  });

  it("sends exactly three requests for the ISO under a failed probe, the third the forced conversion, and plans from it", async () => {
    const { transport, result } = await negotiate("item-iso", iso(), FAILED);
    expect(transport.posts).toHaveLength(3);
    expectDiscFallback(transport.posts[1]);
    expectForced(transport.posts[2], false, "item-iso");
    expectForcedPlan(planOf(result), "item-iso");
  });

  it("refuses the ISO's fallback with no third request on a list with no h264 decoder", async () => {
    const { transport, result } = await negotiate("item-iso", iso(), NO_H264);
    expect(refusalOf(result)).toMatchObject(TARGET);
    expect(transport.posts).toHaveLength(2);
  });

  it("asks for the Blu-ray folder's forced conversion when a codec its URL lists has no decoder (D4), and plans from the recorded answer", async () => {
    const answers = [t823Answer(version, "conversion-bluray-folder"), withSession(t823Answer(version, "device-disc-conversion-bluray-folder"), FORCED)];
    const { transport, result } = await negotiate("item-bluray", answers, NO_AV1_EVERY_AUDIO);
    expect(transport.posts).toHaveLength(2);
    expectForced(transport.posts[1], true, "item-bluray");
    expectForcedPlan(planOf(result), "item-bluray");
  });
});

describe.each(VERSIONS)("T8-23 item 1: a device that plays everything sends today's requests (Jellyfin %s)", (version) => {
  const cases = [
    ["the HEVC fallback as a first answer", "item-hevc", () => [t823Answer(version, "conversion-hevc-hdr10-force-fallback")], 1],
    ["conversion-h264-limited", "item-h264", () => [recorded(version, "conversion-h264-limited")], 1],
    ["the ISO", "item-iso", () => [recorded(version, "conversion-iso"), recorded(version, "conversion-iso-force-fallback")], 2],
    ["the Blu-ray folder", "item-bluray", () => [t823Answer(version, "conversion-bluray-folder")], 1],
    ["the no-decoder sample under a limit", "item-no-decoder", () => [t823Answer(version, "encode-target-no-decoder")], 1],
  ] as const;

  it.each(cases)("%s on EVERYTHING", async (_name, itemId, answers, count) => {
    const { transport, result } = await negotiate(itemId, [...answers()], EVERYTHING);
    expect(transport.posts).toHaveLength(count);
    const plan = planOf(result);
    expect(plan.delivery).toBe("hls");
    expect(plan).not.toHaveProperty("clientConversionReason");
  });

  it.each(cases)('%s on "full"', async (_name, itemId, answers, count) => {
    const { transport, result } = await negotiate(itemId, [...answers()], "full");
    expect(transport.posts).toHaveLength(count);
    expect(planOf(result)).not.toHaveProperty("clientConversionReason");
  });
});

describe("T8-23 item 1: the pinned Jellyscale's limited conversion and its answer to the forced request", () => {
  const answers = () => [t823Answer("jellyscale", "encode-target-h264-limited"), t823Answer("jellyscale", "encode-target-h264-limited-forced")];

  it("the recorded forced answer is the first answer again: Jellyscale ignores the forced flags (#224)", () => {
    const [first, forced] = answers();
    expect(forced.MediaSources![0].TranscodingUrl).toBe(first.MediaSources![0].TranscodingUrl);
    expect(forced.MediaSources![0].TranscodingUrl).not.toMatch(/allowVideoStreamCopy=false/i);
  });

  it.each([
    ["EVERYTHING", EVERYTHING],
    ['"full"', "full"],
  ] as const)("plays the first answer with one request on %s", async (_name, caps) => {
    const { transport, result } = await negotiate("item-h264", answers(), caps);
    expect(transport.posts).toHaveLength(1);
    expect(planOf(result)).toMatchObject({ delivery: "hls", mediaSourceId: "item-h264" });
  });

  it.each([
    ["the list that cannot play H.264 High", withoutH264],
    ["a failed probe", FAILED],
  ] as const)("refuses after the forced request on %s, because the copy is not shown off", async (_name, caps) => {
    const { transport, result } = await negotiate("item-h264", answers(), caps);
    expect(transport.posts).toHaveLength(2);
    expect(transport.posts[1].data).toMatchObject({ EnableDirectPlay: false, AllowVideoStreamCopy: false });
    expect(refusalOf(result)).toMatchObject({ reason: "device-cannot-play", detail: "stream copy not turned off" });
  });

  it("refuses with one request on a list with no h264 decoder", async () => {
    const { transport, result } = await negotiate("item-h264", answers(), NO_H264);
    expect(refusalOf(result)).toMatchObject(TARGET);
    expect(transport.posts).toHaveLength(1);
  });

  it("sends the forced request when the answer says VideoCodec=copy and the device cannot play the source's video (rewritten; unverified by a recording)", async () => {
    const [first, forced] = answers();
    const copying = rewriteUrl(first, /VideoCodec=h264/, "VideoCodec=copy");
    const { transport } = await negotiate("item-h264", [copying, forced], NO_H264);
    expect(transport.posts).toHaveLength(2);
    expectForced(transport.posts[1], true, "item-h264");
  });
});

describe.each(VERSIONS)("T8-23 item 2: the forced answer from Jellyfin %s is checked", (version) => {
  const hevc = () => [recorded(version, "conversion-hevc-hdr10"), withSession(recorded(version, "device-conversion-hevc-hdr10"), FORCED)];

  it("refuses device-conversion-hevc-hdr10 on a list with neither hevc nor h264, after exactly two requests", async () => {
    const { transport, result } = await negotiate("item-hevc", hevc(), NO_HEVC_NO_H264);
    expect(refusalOf(result)).toMatchObject(TARGET);
    expect(refusalOf(result).message).toContain("This device cannot play the file, and the server offered no conversion.");
    expect(transport.posts).toHaveLength(2);
    expectForced(transport.posts[1], true, "item-hevc");
  });

  it("refuses device-conversion-hevc-hdr10 on an h264 decoder limited to 640x360 (the sample is 1280x720), after exactly two requests", async () => {
    const { transport, result } = await negotiate("item-hevc", hevc(), SMALL_H264);
    expect(refusalOf(result)).toMatchObject(TARGET);
    expect(transport.posts).toHaveLength(2);
  });

  it("refuses the recorded H.264 forced answer on a list with no h264 decoder", async () => {
    const answers = [recorded(version, "conversion-h264"), withSession(recorded(version, "device-conversion-h264"), FORCED)];
    const { transport, result } = await negotiate("item-h264", answers, NO_H264);
    expect(refusalOf(result)).toMatchObject(TARGET);
    expect(transport.posts).toHaveLength(2);
  });

  it("refuses a forced answer whose possible copy the device cannot play (audio rewritten to eac3)", async () => {
    const forced = withSession(withStreamCodec(recorded(version, "device-conversion-h264"), 1, "eac3"), FORCED);
    const { transport, result } = await negotiate("item-h264", [recorded(version, "conversion-h264"), forced], withoutH264);
    expect(refusalOf(result)).toMatchObject({ reason: "device-cannot-play", detail: "copied stream not playable" });
    expect(transport.posts).toHaveLength(2);
  });

  it("still plans under a failed probe", async () => {
    const answers = [recorded(version, "conversion-multitrack"), withSession(recorded(version, "device-conversion-multitrack-audio"), FORCED)];
    const { transport, result } = await negotiate("item-multitrack", answers, FAILED);
    expect(transport.posts).toHaveLength(2);
    expectForcedPlan(planOf(result), "item-multitrack");
  });

  it("never puts an address, a play session or a token in the refusal", async () => {
    const error = refusalOf((await negotiate("item-hevc", hevc(), NO_HEVC_NO_H264)).result);
    expect(`${error.message} ${error.detail}`).not.toMatch(/play-session|127\.0\.0\.1|jellyfin\.test|REDACTED|ApiKey|master\.m3u8/);
  });
});

describe.each(VERSIONS)("T8-23 item 2: a viewer's audio pick on Jellyfin %s", (version) => {
  const request = { mediaSourceId: "item-multitrack", options: { audioStreamIndex: 2, keepDirectPlay: true } };
  const answers = () => [
    recorded(version, "conversion-multitrack-audio-pick"),
    recorded(version, "conversion-multitrack"),
    withSession(recorded(version, "device-conversion-multitrack-audio"), FORCED),
  ];

  it("refuses the three-request pick path on a list with only opus, after exactly three requests", async () => {
    const { transport, result } = await negotiate("item-multitrack", answers(), OPUS_ONLY, request);
    expect(refusalOf(result)).toMatchObject(TARGET);
    expect(transport.posts).toHaveLength(3);
  });

  it("plans the three-request pick path from the forced answer on an aac decoder limited to one channel", async () => {
    const { transport, result } = await negotiate("item-multitrack", answers(), AAC_ONE_CHANNEL, request);
    expect(transport.posts).toHaveLength(3);
    expectForced(transport.posts[2], false, "item-multitrack");
    expectForcedPlan(planOf(result), "item-multitrack");
  });
});

describe.each(VERSIONS)("T8-23 item 4: the limits a device reports decide the source (Jellyfin %s)", (version) => {
  const h264 = () => [recorded(version, "conversion-h264"), withSession(recorded(version, "device-conversion-h264"), FORCED)];

  it("sends the forced request for conversion-h264 (Level 30) on an h264 decoder with maxLevel 22", async () => {
    const { transport, result } = await negotiate("item-h264", h264(), capabilities([{ codec: "h264", maxLevel: 22 } as never], ["aac"]));
    expect(transport.posts).toHaveLength(2);
    expectForced(transport.posts[1], true, "item-h264");
    expectForcedPlan(planOf(result), "item-h264");
  });

  it("direct plays conversion-h264 with one request on an h264 decoder with maxLevel 30", async () => {
    const { transport, result } = await negotiate("item-h264", h264(), capabilities([{ codec: "h264", maxLevel: 30 } as never], ["aac"]));
    expect(transport.posts).toHaveLength(1);
    expect(planOf(result)).toMatchObject({ delivery: "static", playMethod: "DirectPlay" });
  });

  it("sends the forced request for the 24 fps sample on an h264 decoder with maxFrameRate 23.9, and not with 24", async () => {
    const slow = await negotiate("item-h264", h264(), capabilities([{ codec: "h264", maxFrameRate: 23.9 } as never], ["aac"]));
    expect(slow.transport.posts).toHaveLength(2);
    expectForced(slow.transport.posts[1], true, "item-h264");
    const enough = await negotiate("item-h264", h264(), capabilities([{ codec: "h264", maxFrameRate: 24 } as never], ["aac"]));
    expect(enough.transport.posts).toHaveLength(1);
  });

  it("turns audio copy off too for the two-channel aac on an aac decoder limited to one channel", async () => {
    const { transport } = await negotiate("item-h264", h264(), AAC_ONE_CHANNEL);
    expect(transport.posts).toHaveLength(2);
    expectForced(transport.posts[1], false, "item-h264");
  });

  it("judges the ac3 track the request names by its six channels, and not the default aac", async () => {
    const request = { mediaSourceId: "item-multitrack", options: { audioStreamIndex: 2 } };
    const answers = [recorded(version, "conversion-multitrack-audio-pick"), withSession(recorded(version, "device-conversion-multitrack-audio"), FORCED)];
    const two = capabilities([{ codec: "h264" }], ["aac", "ac3"], { maxAudioChannels: { ac3: 2 } });
    const limited = await negotiate("item-multitrack", answers, two, request);
    expect(limited.transport.posts).toHaveLength(2);
    expectForced(limited.transport.posts[1], false, "item-multitrack");
    const six = capabilities([{ codec: "h264" }], ["aac", "ac3"], { maxAudioChannels: { ac3: 6, aac: 1 } });
    const plays = await negotiate("item-multitrack", answers, six, request);
    expect(plays.transport.posts).toHaveLength(1);
  });
});
