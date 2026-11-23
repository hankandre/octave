import {
  AUDIO_CODECS,
  HDR_TYPES,
  PASSTHROUGH_FORMATS,
  VIDEO_CODECS,
  type AudioCodec,
  type PlayerCapabilities,
  type VideoDecoder,
} from "./player-engine";

const PROFILE = /^[A-Za-z0-9 .+-]{1,32}$/;
const BIT_DEPTHS: readonly unknown[] = [8, 10, 12];
// The codecs whose level scale is known (player-engine.ts, VideoDecoder.maxLevel).
const LEVEL_CODECS: readonly VideoDecoder["codec"][] = ["h264", "hevc", "av1"];

// Reads an engine's capability answer (T2-05). Only known codecs, HDR types and passthrough formats cross;
// anything the engine could not read, or a shape that is not a capability list, is "cannot tell".
export function readCapabilities(raw: unknown): PlayerCapabilities {
  if (!isRecord(raw) || raw.probe !== "complete") return { probe: "failed" };
  const { videoDecoders, audioDecoders, hdr, passthrough } = raw;
  if (!Array.isArray(videoDecoders) || !Array.isArray(audioDecoders) || !Array.isArray(hdr) || !Array.isArray(passthrough)) {
    return { probe: "failed" };
  }
  const audio = audioWithLimits(known(audioDecoders, AUDIO_CODECS), raw.maxAudioChannels);
  return {
    probe: "complete",
    videoDecoders: uniqueDecoders(videoDecoders),
    audioDecoders: audio.decoders,
    hdr: known(hdr, HDR_TYPES),
    passthrough: known(passthrough, PASSTHROUGH_FORMATS),
    ...(audio.limits ? { maxAudioChannels: audio.limits } : {}),
  };
}

// A bad limit narrows the list and never widens it (T8-23): an audio codec whose channel limit is present and
// invalid is dropped, and a limit map that is not a map drops every audio decoder.
function audioWithLimits(decoders: AudioCodec[], raw: unknown): { decoders: AudioCodec[]; limits?: Partial<Record<AudioCodec, number>> } {
  if (raw == null) return { decoders };
  if (!isRecord(raw)) return { decoders: [] };
  const kept: AudioCodec[] = [];
  const limits: Partial<Record<AudioCodec, number>> = {};
  for (const codec of decoders) {
    if (!(codec in raw)) {
      kept.push(codec);
      continue;
    }
    const limit = raw[codec];
    if (!isPositiveInteger(limit)) continue;
    kept.push(codec);
    limits[codec] = limit;
  }
  return Object.keys(limits).length > 0 ? { decoders: kept, limits } : { decoders: kept };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function known<T extends string>(values: readonly unknown[], allowed: readonly T[]): T[] {
  const kept: T[] = [];
  for (const value of values) {
    if ((allowed as readonly unknown[]).includes(value) && !kept.includes(value as T)) kept.push(value as T);
  }
  return kept;
}

function uniqueDecoders(values: readonly unknown[]): VideoDecoder[] {
  const kept: VideoDecoder[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const decoder = readDecoder(value);
    if (!decoder) continue;
    const key = JSON.stringify([
      decoder.codec,
      decoder.hardware,
      decoder.profile,
      decoder.maxBitDepth,
      decoder.maxWidth,
      decoder.maxHeight,
      decoder.maxLevel,
      decoder.maxFrameRate,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(decoder);
  }
  return kept;
}

function readDecoder(value: unknown): VideoDecoder | undefined {
  if (!isRecord(value)) return undefined;
  const codec = (VIDEO_CODECS as readonly unknown[]).includes(value.codec) ? (value.codec as VideoDecoder["codec"]) : undefined;
  if (!codec || typeof value.hardware !== "boolean") return undefined;
  const decoder: VideoDecoder = { codec, hardware: value.hardware };
  if (typeof value.profile === "string" && PROFILE.test(value.profile)) decoder.profile = value.profile;
  if (BIT_DEPTHS.includes(value.maxBitDepth)) decoder.maxBitDepth = value.maxBitDepth as 8 | 10 | 12;
  if (isPositiveInteger(value.maxWidth)) decoder.maxWidth = value.maxWidth;
  if (isPositiveInteger(value.maxHeight)) decoder.maxHeight = value.maxHeight;
  // A level or frame rate that is present and invalid drops the decoder: a bad limit never widens the list.
  if (value.maxLevel != null) {
    if (!LEVEL_CODECS.includes(codec) || !isNonNegativeInteger(value.maxLevel)) return undefined;
    decoder.maxLevel = value.maxLevel;
  }
  if (value.maxFrameRate != null) {
    if (!isPositiveNumber(value.maxFrameRate)) return undefined;
    decoder.maxFrameRate = value.maxFrameRate;
  }
  return decoder;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

// av1's seq_level_idx starts at 0 (level 2.0).
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
