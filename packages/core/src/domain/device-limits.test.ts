import { describe, expect, it } from "vitest";
import oldConversionH264 from "../../tests/fixtures/jellyfin/10.11.7/conversion-h264.json";
import newConversionAv1 from "../../tests/fixtures/jellyfin/12.4.0/conversion-av1.json";
import newConversionH264 from "../../tests/fixtures/jellyfin/12.4.0/conversion-h264.json";
import newConversionHevcHdr10 from "../../tests/fixtures/jellyfin/12.4.0/conversion-hevc-hdr10.json";
import newConversionMultitrack from "../../tests/fixtures/jellyfin/12.4.0/conversion-multitrack.json";
import jellyscaleH264 from "../../tests/fixtures/jellyscale/b920b193cd6f/playbackinfo-h264-profile.json";
import { devicePlayability, type SourceFormat } from "./device-capabilities";
import type { AudioCodec, PassthroughFormat, PlayerCapabilities, VideoDecoder } from "./player-engine";

// T8-23 item 4: the source decision reads level, frame rate and channel count beside codec, profile, bit depth and
// size (spec "The source decision reads more"). The source values are the recorded streams'.
interface RecordedStream {
  Type?: string;
  Codec?: string | null;
  Profile?: string | null;
  BitDepth?: number | null;
  Width?: number | null;
  Height?: number | null;
  Level?: number | null;
  ReferenceFrameRate?: number | null;
  Channels?: number | null;
  Index?: number | null;
}

interface RecordedAnswer {
  MediaSources?: { MediaStreams?: RecordedStream[] }[];
}

const value = <T>(field: T | null | undefined): T | undefined => (field === null ? undefined : field);

// The judged video and one audio stream of a recorded answer, as SourceFormat (spec: video.level, video.frameRate,
// audio.channels beside the T2-07 fields).
function formatOf(answer: unknown, audioIndex?: number): SourceFormat {
  const streams = (answer as RecordedAnswer).MediaSources?.[0]?.MediaStreams ?? [];
  const video = streams.find((stream) => stream.Type === "Video");
  const audios = streams.filter((stream) => stream.Type === "Audio");
  const audio = audios.find((stream) => stream.Index === audioIndex) ?? audios[0];
  if (!video || !audio) throw new Error("the recorded answer has no video or no audio stream");
  return {
    video: {
      codec: value(video.Codec),
      profile: value(video.Profile),
      bitDepth: value(video.BitDepth),
      width: value(video.Width),
      height: value(video.Height),
      level: value(video.Level),
      frameRate: value(video.ReferenceFrameRate),
    },
    audio: { codec: value(audio.Codec), channels: value(audio.Channels) },
  } as SourceFormat;
}

function complete(videoDecoders: VideoDecoder[], audioDecoders: AudioCodec[] = ["aac"], extra: Record<string, unknown> = {}, passthrough: PassthroughFormat[] = []): PlayerCapabilities {
  return { probe: "complete", videoDecoders, audioDecoders, hdr: [], passthrough, ...extra } as PlayerCapabilities;
}

const decoder = (codec: VideoDecoder["codec"], limits: Record<string, number>): VideoDecoder => ({ codec, hardware: true, ...limits }) as VideoDecoder;

const H264 = formatOf(newConversionH264);
const H264_OLD = formatOf(oldConversionH264);
const HEVC = formatOf(newConversionHevcHdr10);
const AV1 = formatOf(newConversionAv1);
const JELLYSCALE_H264 = formatOf(jellyscaleH264);
const MULTITRACK_AC3 = formatOf(newConversionMultitrack, 2);

describe("T8-23 item 4: the recorded values the rules compare", () => {
  it("reads the level, frame rate and channels the recorded streams state", () => {
    expect(H264.video).toMatchObject({ codec: "h264", level: 30, frameRate: 24 });
    expect(H264_OLD.video).toMatchObject({ codec: "h264", level: 30, frameRate: 24 });
    expect(HEVC.video).toMatchObject({ codec: "hevc", level: 93, frameRate: 24 });
    expect(AV1.video).toMatchObject({ codec: "av1", level: 1, frameRate: 24 });
    expect(H264.audio).toMatchObject({ codec: "aac", channels: 2 });
    expect(MULTITRACK_AC3.audio).toMatchObject({ codec: "ac3", channels: 6 });
    expect(JELLYSCALE_H264.video).toMatchObject({ codec: "h264", frameRate: 24 });
    expect((JELLYSCALE_H264.video as { level?: number }).level).toBeUndefined();
  });
});

describe("T8-23 item 4: the level a video decoder states", () => {
  it.each([
    ["h264", H264, 30, 22],
    ["h264 (Jellyfin 10.11.7)", H264_OLD, 30, 22],
    ["hevc", HEVC, 93, 90],
    ["av1", AV1, 1, 0],
  ] as const)("%s plays at and under the limit and not over it", (_name, format, at, under) => {
    const codec = format.video!.codec as VideoDecoder["codec"];
    expect(devicePlayability(format, complete([decoder(codec, { maxLevel: at })])).video).toBe(true);
    expect(devicePlayability(format, complete([decoder(codec, { maxLevel: at + 30 })])).video).toBe(true);
    expect(devicePlayability(format, complete([decoder(codec, { maxLevel: under })])).video).toBe(false);
  });

  it("plays a source that states no level (the pinned Jellyscale's stream)", () => {
    expect(devicePlayability(JELLYSCALE_H264, complete([decoder("h264", { maxLevel: 10 })]))).toEqual({ video: true, audio: true });
  });

  it("plays another decoder of the codec whose level is enough", () => {
    const caps = complete([decoder("h264", { maxLevel: 22 }), decoder("h264", { maxLevel: 41 })]);
    expect(devicePlayability(H264, caps).video).toBe(true);
  });
});

describe("T8-23 item 4: the frame rate a video decoder states", () => {
  it("plays at the limit and within the 0.05 slack", () => {
    expect(devicePlayability(H264, complete([decoder("h264", { maxFrameRate: 24 })])).video).toBe(true);
    expect(devicePlayability(H264, complete([decoder("h264", { maxFrameRate: 23.96 })])).video).toBe(true);
    expect(devicePlayability(H264, complete([decoder("h264", { maxFrameRate: 60 })])).video).toBe(true);
  });

  it("does not play over the limit and the slack", () => {
    expect(devicePlayability(H264, complete([decoder("h264", { maxFrameRate: 23.9 })])).video).toBe(false);
    expect(devicePlayability(H264, complete([decoder("h264", { maxFrameRate: 15 })])).video).toBe(false);
  });

  it("does not play a source that states no frame rate when a limit is stated", () => {
    const unknown = { ...H264, video: { ...H264.video, frameRate: undefined } } as SourceFormat;
    expect(devicePlayability(unknown, complete([decoder("h264", { maxFrameRate: 60 })])).video).toBe(false);
    expect(devicePlayability(unknown, complete([decoder("h264", {})])).video).toBe(true);
  });
});

describe("T8-23 item 4: the channel count an audio decoder states", () => {
  it("plays at the limit and not over it", () => {
    expect(devicePlayability(H264, complete([decoder("h264", {})], ["aac"], { maxAudioChannels: { aac: 2 } })).audio).toBe(true);
    expect(devicePlayability(H264, complete([decoder("h264", {})], ["aac"], { maxAudioChannels: { aac: 8 } })).audio).toBe(true);
    expect(devicePlayability(H264, complete([decoder("h264", {})], ["aac"], { maxAudioChannels: { aac: 1 } })).audio).toBe(false);
    expect(devicePlayability(MULTITRACK_AC3, complete([decoder("h264", {})], ["ac3"], { maxAudioChannels: { ac3: 2 } })).audio).toBe(false);
    expect(devicePlayability(MULTITRACK_AC3, complete([decoder("h264", {})], ["ac3"], { maxAudioChannels: { ac3: 6 } })).audio).toBe(true);
  });

  it("reads only the limit stated for the stream's codec", () => {
    expect(devicePlayability(H264, complete([decoder("h264", {})], ["aac", "ac3"], { maxAudioChannels: { ac3: 1 } })).audio).toBe(true);
  });

  it("does not play a source that states no channel count when a limit is stated for its codec", () => {
    const unknown = { ...H264, audio: { codec: "aac" } } as SourceFormat;
    expect(devicePlayability(unknown, complete([decoder("h264", {})], ["aac"], { maxAudioChannels: { aac: 8 } })).audio).toBe(false);
    expect(devicePlayability(unknown, complete([decoder("h264", {})], ["aac"])).audio).toBe(true);
  });

  it("does not limit passthrough: the receiver decodes", () => {
    const passthroughOnly = complete([decoder("h264", {})], ["aac"], { maxAudioChannels: { ac3: 2 } }, ["ac3"]);
    expect(devicePlayability(MULTITRACK_AC3, passthroughOnly).audio).toBe(true);
    const both = complete([decoder("h264", {})], ["ac3"], { maxAudioChannels: { ac3: 2 } }, ["ac3"]);
    expect(devicePlayability(MULTITRACK_AC3, both).audio).toBe(true);
  });
});

describe("T8-23 item 4: absent limits behave as today", () => {
  it("plays every recorded stream on decoders that state no level, frame rate or channel limit", () => {
    const caps = complete(
      [decoder("h264", {}), decoder("hevc", {}), decoder("av1", {})],
      ["aac", "ac3"],
    );
    for (const format of [H264, H264_OLD, HEVC, AV1, JELLYSCALE_H264, MULTITRACK_AC3]) {
      expect(devicePlayability(format, caps)).toEqual({ video: true, audio: true });
    }
  });

  it('keeps "full" and a failed probe as they are', () => {
    expect(devicePlayability(H264, "full")).toEqual({ video: true, audio: true });
    expect(devicePlayability(H264, { probe: "failed" })).toEqual({ video: false, audio: false });
  });
});
