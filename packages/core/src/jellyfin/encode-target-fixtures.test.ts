import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PlaybackInfoResponse } from "./types";

// T8-23 milestone 1 (acceptance 3, reviewed as spec text): the encode-target recordings hold to the first-of-list rule
// (D1). Each recording is a conversion the server built for Octave's profile, the CODECS attribute of its master
// playlist, and the session's TranscodingInfo when the server reported one. Reads committed JSON only.
const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "../../tests/fixtures");

function pinFolder(): string {
  const compose = readFileSync(join(here, "../../../../tests/integration/docker-compose.yml"), "utf8");
  const sha = /^x-jellyscale-commit:\s*([0-9a-f]{40})\b/m.exec(compose)?.[1];
  if (!sha) throw new Error("docker-compose.yml has no x-jellyscale-commit of 40 hex characters");
  return sha.slice(0, 12);
}

interface Recording {
  server: string;
  sample: string;
  recorded: boolean;
  request: Record<string, unknown>;
  answer: PlaybackInfoResponse;
  master?: { status: number; codecs: string[][] };
  transcodingInfo?: { VideoCodec: string | null; AudioCodec: string | null; IsVideoDirect: boolean | null; IsAudioDirect: boolean | null } | null;
}

function load(folder: string, name: string): Recording {
  return JSON.parse(readFileSync(join(fixtures, folder, `${name}.json`), "utf8")) as Recording;
}

function listOf(recording: Recording, name: string): string[] {
  const url = new URL(recording.answer.MediaSources![0].TranscodingUrl!, "http://server.test");
  const value = [...url.searchParams].find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? "";
  return value.split(",").map((codec) => codec.trim().toLowerCase()).filter(Boolean);
}

function sourceCodec(recording: Recording, type: string): string | undefined {
  return recording.answer.MediaSources![0].MediaStreams?.find((stream) => stream.Type === type)?.Codec?.toLowerCase() ?? undefined;
}

// The RFC 6381 prefix of each codec the target can be.
const CODECS_PREFIX: Record<string, string> = { h264: "avc1.", hevc: "hvc1.", av1: "av01.", vp9: "vp09.", aac: "mp4a.40.", ac3: "ac-3", eac3: "ec-3", opus: "opus", flac: "flac", mp3: "mp4a.40.34" };

function expectTarget(recording: Recording) {
  expect(recording.recorded).toBe(true);
  expect(recording.master?.status).toBe(200);
  const [videoTarget] = listOf(recording, "VideoCodec");
  const [audioTarget] = listOf(recording, "AudioCodec");
  const variants = recording.master!.codecs;
  expect(variants.length).toBeGreaterThan(0);
  for (const codecs of variants) {
    expect(codecs.some((codec) => codec.startsWith(CODECS_PREFIX[videoTarget])), `${codecs} holds ${videoTarget}`).toBe(true);
    expect(codecs.some((codec) => codec.startsWith(CODECS_PREFIX[audioTarget])), `${codecs} holds ${audioTarget}`).toBe(true);
  }
  if (recording.transcodingInfo) {
    expect(recording.transcodingInfo.VideoCodec?.toLowerCase()).toBe(videoTarget);
    expect(recording.transcodingInfo.AudioCodec?.toLowerCase()).toBe(audioTarget);
  }
}

describe.each(["10.11.7", "12.4.0"])("T8-23 milestone 1: what Jellyfin %s encodes into", (version) => {
  const folder = `jellyfin/${version}`;

  it.each([
    ["encode-target-hevc-hdr10", "hevc"],
    ["encode-target-av1", "av1"],
  ])("%s: the forced conversion of the %s sample is the first codec of each list, H.264 and AAC", (name, source) => {
    const recording = load(folder, name);
    expect(sourceCodec(recording, "Video")).toBe(source);
    expect(recording.request).toMatchObject({ EnableDirectPlay: false, AllowVideoStreamCopy: false });
    expect(listOf(recording, "VideoCodec")).toEqual(["h264", "hevc", "av1", "vp9"]);
    expect(listOf(recording, "AudioCodec")[0]).toBe("aac");
    expectTarget(recording);
    expect(recording.transcodingInfo).toMatchObject({ VideoCodec: "h264", AudioCodec: "aac", IsVideoDirect: false });
  });

  it("encode-target-no-decoder: a video codec outside the list is encoded, never copied", () => {
    const recording = load(folder, "encode-target-no-decoder");
    expect(recording.request).toMatchObject({ EnableDirectPlay: true, AllowVideoStreamCopy: true });
    const source = sourceCodec(recording, "Video")!;
    expect(listOf(recording, "VideoCodec")).not.toContain(source);
    expectTarget(recording);
    for (const codecs of recording.master!.codecs) expect(codecs.some((codec) => codec.startsWith("avc1."))).toBe(true);
    expect(recording.transcodingInfo).toMatchObject({ VideoCodec: "h264", IsVideoDirect: false });
  });

  it.each(["device-disc-conversion-iso", "device-disc-conversion-bluray-folder"])("%s: a conversion with both copies shown off", (name) => {
    const answer = JSON.parse(readFileSync(join(fixtures, folder, `${name}.json`), "utf8")) as PlaybackInfoResponse;
    const source = answer.MediaSources![0];
    expect(source.TranscodingSubProtocol).toBe("hls");
    expect(source.TranscodingUrl).toMatch(/[?&]allowVideoStreamCopy=false(&|$)/i);
    expect(source.TranscodingUrl).toMatch(/[?&]allowAudioStreamCopy=false(&|$)/i);
    expect(source.TranscodingUrl).toContain("ApiKey=REDACTED");
  });
});

describe("T8-23 milestone 1: what the pinned Jellyscale encodes into", () => {
  const folder = () => `jellyscale/${pinFolder()}`;

  it.each(["encode-target-h264-limited", "encode-target-hevc-hdr10", "encode-target-av1", "encode-target-no-decoder"])(
    "%s: a limited conversion names VideoCodec=h264, the encode form, and the master is H.264 and AAC",
    (name) => {
      const recording = load(folder(), name);
      expect(recording.request).toMatchObject({ EnableDirectPlay: true });
      expect(listOf(recording, "VideoCodec")).toEqual(["h264"]);
      expectTarget(recording);
    },
  );

  it("encode-target-h264-limited-forced: the forced request is answered with the same conversion (Jellyscale #224)", () => {
    const first = load(folder(), "encode-target-h264-limited");
    const forced = load(folder(), "encode-target-h264-limited-forced");
    expect(forced.request).toMatchObject({ EnableDirectPlay: false, AllowVideoStreamCopy: false });
    expect(forced.answer.MediaSources![0].TranscodingUrl).toBe(first.answer.MediaSources![0].TranscodingUrl);
    expect(forced.answer.MediaSources![0].TranscodingUrl).not.toMatch(/allowVideoStreamCopy=false/i);
  });
});
