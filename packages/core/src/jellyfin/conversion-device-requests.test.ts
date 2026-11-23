import { describe, expect, it } from "vitest";
import type { PlayerCapabilities } from "../domain/player-engine";
import { MemoryStreamingLimits } from "../streaming-limits";
import { AAC_ONE_CHANNEL, NO_AV1_EVERY_AUDIO, NO_H264, OPUS_ONLY, rewriteUrl, t823Answer } from "./conversion-device-test-support";
import { MAX_BITRATE, OCTAVE_PROFILE } from "./device-profile";
import { FAILED, negotiate, recorded, VERSIONS, withoutAc3, withoutH264, withoutHevc, type NegotiateOptions, type Post } from "./device-test-support";
import type { PlaybackInfoResponse } from "./types";

// T8-23 item 5: on every new path to the forced conversion the DeviceProfile is the same, no rule adds a request
// beyond the one forced conversion, and every request is one of the four kinds the negotiation already sends, by its
// flags, in the body and in the query.
const FLAGS = ["EnableDirectPlay", "AllowVideoStreamCopy", "AllowAudioStreamCopy", "EnableDirectStream", "EnableTranscoding", "AutoOpenLiveStream"] as const;

type Kind = "first" | "plain" | "disc-fallback" | "forced";

function flag(post: Post, name: string): boolean {
  const body = post.data[name];
  const query = post.query.filter(([key]) => key === name).map(([, value]) => value);
  expect(typeof body, `${name} in the body`).toBe("boolean");
  expect(query, `${name} once in the query`).toHaveLength(1);
  expect(query[0], `${name} the same in body and query`).toBe(String(body));
  return body as boolean;
}

function kindOf(post: Post, index: number): Kind {
  for (const name of FLAGS) flag(post, name);
  expect(flag(post, "EnableDirectStream")).toBe(true);
  expect(flag(post, "EnableTranscoding")).toBe(true);
  expect(flag(post, "AutoOpenLiveStream")).toBe(false);
  const directPlay = flag(post, "EnableDirectPlay");
  const videoCopy = flag(post, "AllowVideoStreamCopy");
  const audioCopy = flag(post, "AllowAudioStreamCopy");
  if (directPlay) {
    expect(videoCopy && audioCopy, "a request with direct play keeps both copies").toBe(true);
    return index === 0 ? "first" : "plain";
  }
  if (videoCopy) {
    expect(audioCopy, "a disc fallback keeps the audio copy").toBe(true);
    return "disc-fallback";
  }
  return "forced";
}

interface Path {
  name: string;
  itemId: string;
  answers: () => PlaybackInfoResponse[];
  caps: PlayerCapabilities;
  extra?: NegotiateOptions;
  // The kinds in order, as the spec's "Requests" gives them.
  kinds: readonly Kind[];
}

const pick = { mediaSourceId: "item-multitrack", options: { audioStreamIndex: 2, keepDirectPlay: true } };

function paths(version: string): Path[] {
  const iso = () => [recorded(version, "conversion-iso"), recorded(version, "conversion-iso-force-fallback"), t823Answer(version, "device-disc-conversion-iso")];
  const multitrack = () => [recorded(version, "conversion-multitrack-audio-pick"), recorded(version, "conversion-multitrack"), recorded(version, "device-conversion-multitrack-audio")];
  return [
    { name: "a first-answer conversion (the HEVC fallback answer) on a list without hevc", itemId: "item-hevc", answers: () => [t823Answer(version, "conversion-hevc-hdr10-force-fallback"), recorded(version, "device-conversion-hevc-hdr10")], caps: withoutHevc, kinds: ["first", "forced"] },
    { name: "conversion-h264-limited on the list that cannot play H.264 High", itemId: "item-h264", answers: () => [recorded(version, "conversion-h264-limited"), recorded(version, "device-conversion-h264")], caps: withoutH264, kinds: ["first", "forced"] },
    { name: "conversion-h264-limited on a list with no h264 decoder", itemId: "item-h264", answers: () => [recorded(version, "conversion-h264-limited")], caps: NO_H264, kinds: ["first"] },
    { name: "the ISO's fallback on a list without ac3", itemId: "item-iso", answers: iso, caps: withoutAc3, kinds: ["first", "disc-fallback", "forced"] },
    { name: "the ISO's fallback under a failed probe", itemId: "item-iso", answers: iso, caps: FAILED, kinds: ["first", "disc-fallback", "forced"] },
    { name: "the Blu-ray folder on a list without av1", itemId: "item-bluray", answers: () => [t823Answer(version, "conversion-bluray-folder"), t823Answer(version, "device-disc-conversion-bluray-folder")], caps: NO_AV1_EVERY_AUDIO, kinds: ["first", "forced"] },
    { name: "the pick path on a list with only opus", itemId: "item-multitrack", answers: multitrack, caps: OPUS_ONLY, extra: pick, kinds: ["first", "plain", "forced"] },
    { name: "the pick path on an aac decoder limited to one channel", itemId: "item-multitrack", answers: multitrack, caps: AAC_ONE_CHANNEL, extra: pick, kinds: ["first", "plain", "forced"] },
    {
      name: "a refused picked answer whose plain answer is a disc (four at most)",
      itemId: "item-iso",
      answers: () => {
        const refused = recorded(version, "conversion-iso");
        refused.MediaSources![0].SupportsDirectPlay = false;
        refused.MediaSources![0].SupportsTranscoding = false;
        return [refused, recorded(version, "conversion-iso"), recorded(version, "conversion-iso-force-fallback"), t823Answer(version, "device-disc-conversion-iso")];
      },
      caps: withoutAc3,
      extra: { mediaSourceId: "item-iso", options: { audioStreamIndex: 1, keepDirectPlay: true } },
      kinds: ["first", "plain", "disc-fallback", "forced"],
    },
  ];
}

const jellyscale = (): Path[] => {
  const first = () => t823Answer("jellyscale", "encode-target-h264-limited");
  const forced = () => t823Answer("jellyscale", "encode-target-h264-limited-forced");
  return [
    { name: "the pinned Jellyscale's limited conversion on the list that cannot play H.264 High", itemId: "item-h264", answers: () => [first(), forced()], caps: withoutH264, kinds: ["first", "forced"] },
    { name: "the pinned Jellyscale's limited conversion under a failed probe", itemId: "item-h264", answers: () => [first(), forced()], caps: FAILED, kinds: ["first", "forced"] },
    { name: "the pinned Jellyscale's VideoCodec=copy form (rewritten)", itemId: "item-h264", answers: () => [rewriteUrl(first(), /VideoCodec=h264/, "VideoCodec=copy"), forced()], caps: NO_H264, kinds: ["first", "forced"] },
  ];
};

async function expectRequests(path: Path, mbps?: number) {
  const limits = mbps === undefined ? undefined : new MemoryStreamingLimits({ localMbps: mbps });
  const { transport } = await negotiate(path.itemId, path.answers(), path.caps, { ...path.extra, limits });
  const posts = transport.posts;
  const bitrate = mbps === undefined ? MAX_BITRATE : mbps * 1_000_000;
  expect(posts.map((post, index) => kindOf(post, index))).toEqual(path.kinds);
  expect(posts.length).toBeLessThanOrEqual(4);
  expect(posts.filter((post) => post.data.AllowVideoStreamCopy === false)).toHaveLength(path.kinds.filter((kind) => kind === "forced").length);
  expect(posts.filter((post) => post.data.AllowVideoStreamCopy === false).length).toBeLessThanOrEqual(1);
  for (const post of posts) {
    expect(post.data.DeviceProfile).toEqual({ ...OCTAVE_PROFILE, MaxStreamingBitrate: bitrate });
    expect(post.data.MaxStreamingBitrate).toBe(bitrate);
  }
}

describe.each(VERSIONS)("T8-23 item 5: the requests of every new path on Jellyfin %s", (version) => {
  it.each(paths(version).map((path) => [path.name, path] as const))("%s", async (_name, path) => {
    await expectRequests(path);
  });

  it.each(paths(version).map((path) => [path.name, path] as const))("%s, under a streaming limit", async (_name, path) => {
    await expectRequests(path, 20);
  });
});

describe("T8-23 item 5: the requests of the new paths on the pinned Jellyscale", () => {
  it.each(jellyscale().map((path) => [path.name, path] as const))("%s", async (_name, path) => {
    await expectRequests(path);
  });
});
