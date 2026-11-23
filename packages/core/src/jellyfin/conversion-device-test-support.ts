// Test support for the T8-23 files: the answers T8-23's recorder wrote (tests/integration/record-encode-targets.mjs),
// capability lists, and small rewrites of a recorded answer. Ordinary source imported by tests only, in the style of
// device-test-support.ts: it imports no test library and no adapter, and reads no host global.
import type { PlayerCapabilities, VideoDecoder } from "../domain/player-engine";
import type { PlaybackInfoResponse } from "./types";
import oldBlurayFolder from "../../tests/fixtures/jellyfin/10.11.7/conversion-bluray-folder.json";
import oldHevcFallback from "../../tests/fixtures/jellyfin/10.11.7/conversion-hevc-hdr10-force-fallback.json";
import newBlurayFolder from "../../tests/fixtures/jellyfin/12.4.0/conversion-bluray-folder.json";
import newHevcFallback from "../../tests/fixtures/jellyfin/12.4.0/conversion-hevc-hdr10-force-fallback.json";
import oldDiscIso from "../../tests/fixtures/jellyfin/10.11.7/device-disc-conversion-iso.json";
import oldDiscBluray from "../../tests/fixtures/jellyfin/10.11.7/device-disc-conversion-bluray-folder.json";
import oldTargetHevc from "../../tests/fixtures/jellyfin/10.11.7/encode-target-hevc-hdr10.json";
import oldTargetAv1 from "../../tests/fixtures/jellyfin/10.11.7/encode-target-av1.json";
import oldTargetNoDecoder from "../../tests/fixtures/jellyfin/10.11.7/encode-target-no-decoder.json";
import newDiscIso from "../../tests/fixtures/jellyfin/12.4.0/device-disc-conversion-iso.json";
import newDiscBluray from "../../tests/fixtures/jellyfin/12.4.0/device-disc-conversion-bluray-folder.json";
import newTargetHevc from "../../tests/fixtures/jellyfin/12.4.0/encode-target-hevc-hdr10.json";
import newTargetAv1 from "../../tests/fixtures/jellyfin/12.4.0/encode-target-av1.json";
import newTargetNoDecoder from "../../tests/fixtures/jellyfin/12.4.0/encode-target-no-decoder.json";
import scaleTargetH264Limited from "../../tests/fixtures/jellyscale/b920b193cd6f/encode-target-h264-limited.json";
import scaleTargetH264LimitedForced from "../../tests/fixtures/jellyscale/b920b193cd6f/encode-target-h264-limited-forced.json";

// Recorded answers device-test-support.ts does not list, and the answers T8-23's recorder wrote.
const ANSWERS: Record<string, unknown> = {
  "10.11.7/conversion-bluray-folder": oldBlurayFolder,
  "10.11.7/conversion-hevc-hdr10-force-fallback": oldHevcFallback,
  "12.4.0/conversion-bluray-folder": newBlurayFolder,
  "12.4.0/conversion-hevc-hdr10-force-fallback": newHevcFallback,
  "10.11.7/device-disc-conversion-iso": oldDiscIso,
  "10.11.7/device-disc-conversion-bluray-folder": oldDiscBluray,
  "12.4.0/device-disc-conversion-iso": newDiscIso,
  "12.4.0/device-disc-conversion-bluray-folder": newDiscBluray,
};

// The PlaybackInfo answer inside each encode-target recording.
const TARGETS: Record<string, unknown> = {
  "10.11.7/encode-target-hevc-hdr10": oldTargetHevc,
  "10.11.7/encode-target-av1": oldTargetAv1,
  "10.11.7/encode-target-no-decoder": oldTargetNoDecoder,
  "12.4.0/encode-target-hevc-hdr10": newTargetHevc,
  "12.4.0/encode-target-av1": newTargetAv1,
  "12.4.0/encode-target-no-decoder": newTargetNoDecoder,
  "jellyscale/encode-target-h264-limited": scaleTargetH264Limited,
  "jellyscale/encode-target-h264-limited-forced": scaleTargetH264LimitedForced,
};

function copyOf<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// A T8-23 answer by "<version>/<file name without the extension>", or "jellyscale/<file>" for the pinned Jellyscale.
// An encode-target file gives the PlaybackInfo answer it recorded.
export function t823Answer(version: string, name: string): PlaybackInfoResponse {
  const key = `${version}/${name}`;
  if (key in ANSWERS) return copyOf(ANSWERS[key] as PlaybackInfoResponse);
  const target = TARGETS[key] as { answer?: PlaybackInfoResponse } | undefined;
  if (!target?.answer) throw new Error(`missing fixture ${key}`);
  return copyOf(target.answer);
}

// Rewrites one value of the first source's TranscodingUrl (PO ruling on D5, condition 3: where no recording can be
// made, a test rewrites one value of a recorded answer).
export function rewriteUrl(answer: PlaybackInfoResponse, from: RegExp, to: string): PlaybackInfoResponse {
  const copy = copyOf(answer);
  const source = copy.MediaSources![0];
  const before = source.TranscodingUrl!;
  source.TranscodingUrl = before.replace(from, to);
  if (source.TranscodingUrl === before) throw new Error(`${from} not found in the recorded TranscodingUrl`);
  return copy;
}

// Sets the codec of the first source's stream with this index.
export function withStreamCodec(answer: PlaybackInfoResponse, index: number, codec: string): PlaybackInfoResponse {
  const copy = copyOf(answer);
  const stream = (copy.MediaSources![0].MediaStreams ?? []).find((candidate) => candidate.Index === index);
  if (!stream) throw new Error(`no stream ${index}`);
  stream.Codec = codec;
  return copy;
}

// A complete list from decoders and audio codecs, with optional extra fields (maxAudioChannels).
export function capabilities(videoDecoders: readonly Partial<VideoDecoder>[], audioDecoders: readonly string[], extra: Record<string, unknown> = {}, passthrough: readonly string[] = []): PlayerCapabilities {
  return {
    probe: "complete",
    videoDecoders: videoDecoders.map((decoder) => ({ hardware: true, ...decoder })),
    audioDecoders: [...audioDecoders],
    hdr: [],
    passthrough: [...passthrough],
    ...extra,
  } as PlayerCapabilities;
}

const EVERY_AUDIO = ["aac", "ac3", "eac3", "opus", "flac", "mp3"];

// No h264 decoder at all: the H.264 a conversion is encoded into cannot be decoded.
export const NO_H264 = capabilities([{ codec: "hevc" }, { codec: "av1" }], ["aac", "ac3"]);
// Neither hevc nor h264 (spec item 2).
export const NO_HEVC_NO_H264 = capabilities([{ codec: "av1" }, { codec: "vp9" }], ["aac", "ac3"]);
// An h264 decoder limited to 640x360, no hevc: the HEVC sample is 1280x720 (spec item 2).
export const SMALL_H264 = capabilities([{ codec: "h264", maxWidth: 640, maxHeight: 360 }, { codec: "av1" }], ["aac", "ac3"]);
// Every codec the conversion URLs list, but av1 (the Blu-ray folder rule, D4).
export const NO_AV1_EVERY_AUDIO = capabilities([{ codec: "h264" }, { codec: "hevc" }, { codec: "vp9" }], EVERY_AUDIO);
// Every listed codec; eac3 by passthrough only.
export const EAC3_PASSTHROUGH = capabilities([{ codec: "h264" }, { codec: "hevc" }, { codec: "av1" }, { codec: "vp9" }], ["aac", "ac3", "opus", "flac", "mp3"], {}, ["eac3"]);
// Only opus audio (the three-request pick path, PO ruling).
export const OPUS_ONLY = capabilities([{ codec: "h264" }], ["opus"]);
// An aac decoder limited to one channel (the samples' aac has two).
export const AAC_ONE_CHANNEL = capabilities([{ codec: "h264" }], ["aac"], { maxAudioChannels: { aac: 1 } });
