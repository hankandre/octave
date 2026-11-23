// What the device can play, read against one source's judged streams (T2-07, ARCHITECTURE.md §3 rule 3), and
// whether it decodes what a server conversion encodes into (T8-23). Pure: it takes plain SourceFormat and
// EncodeTarget values, so no server DTO reaches the domain.
import type { AudioCodec, PassthroughFormat, PlayerCapabilities, VideoCodec, VideoDecoder } from "./player-engine";

// "full" is a negotiation-side value: the host states no device limit, so every source is playable. An engine cannot
// report it.
export type DeviceCapabilities = "full" | PlayerCapabilities;

export interface SourceFormat {
  video?: {
    codec?: string;
    profile?: string;
    bitDepth?: number;
    width?: number;
    height?: number;
    // MediaStream.Level, in Jellyfin's scale for the codec (VideoDecoder.maxLevel).
    level?: number;
    // MediaStream.ReferenceFrameRate.
    frameRate?: number;
  };
  audio?: { codec?: string; channels?: number };
}

// What a server conversion encodes into: the first codec of the URL's list, and the size and frame rate the source
// and the URL's limits give. Its profile, bit depth, level and channel count are not known, so they are not judged.
export interface EncodeTarget {
  video?: { codec: string; width?: number; height?: number; frameRate?: number };
  audio?: { codec: string };
}

export interface Playability {
  video: boolean;
  audio: boolean;
}

type Complete = Extract<PlayerCapabilities, { probe: "complete" }>;

// The audio codecs a passthrough format lets the device play without a decoder (decision 0003, item 2).
const PASSTHROUGH_FOR: Readonly<Record<string, readonly PassthroughFormat[]>> = {
  ac3: ["ac3"],
  eac3: ["eac3", "eac3-joc"],
  dts: ["dts", "dts-hd"],
  truehd: ["truehd"],
};

// The frame-rate slack copiesEverything already uses (source-acceptance.ts).
const FRAME_RATE_SLACK = 0.05;

// A limit the decoder states needs a value the source gives, and not above it.
function within(limit: number | undefined, actual: number | undefined, slack = 0): boolean {
  if (limit === undefined) return true;
  return typeof actual === "number" && actual <= limit + slack;
}

// A limit judged only when the value is known: a missing value is not judged.
function withinWhenKnown(limit: number | undefined, actual: number | undefined, slack = 0): boolean {
  if (limit === undefined || actual === undefined) return true;
  return actual <= limit + slack;
}

export function devicePlayability(format: SourceFormat, capabilities: DeviceCapabilities): Playability {
  if (capabilities === "full") return { video: true, audio: true };
  if (capabilities.probe !== "complete") return { video: false, audio: false };
  // A source with neither stream gives nothing to judge.
  if (!format.video && !format.audio) return { video: false, audio: false };
  return {
    video: format.video ? videoPlayable(format.video, capabilities) : true,
    audio: format.audio ? audioPlayable(format.audio.codec, format.audio.channels, capabilities) : true,
  };
}

// Whether the device decodes a conversion's encode target: codec, size and frame rate, each compared only when the
// target gives it. A failed probe cannot tell and "full" states no limit; the caller decides what a failed probe
// means for a target (T8-23 D3).
export function deviceDecodesTarget(target: EncodeTarget, capabilities: DeviceCapabilities): Playability {
  if (capabilities === "full") return { video: true, audio: true };
  if (capabilities.probe !== "complete") return { video: false, audio: false };
  return {
    video: target.video ? targetVideoDecodes(target.video, capabilities) : true,
    audio: target.audio ? audioPlayable(target.audio.codec, undefined, capabilities, false) : true,
  };
}

function decodersOf(codecName: string | undefined, capabilities: Complete): VideoDecoder[] {
  const codec = codecName?.toLowerCase();
  if (!codec) return [];
  return capabilities.videoDecoders.filter((decoder) => decoder.codec === (codec as VideoCodec));
}

function videoPlayable(video: NonNullable<SourceFormat["video"]>, capabilities: Complete): boolean {
  const profile = video.profile?.trim().toLowerCase();
  return decodersOf(video.codec, capabilities).some((decoder) => {
    if (decoder.profile !== undefined && decoder.profile.trim().toLowerCase() !== profile) return false;
    return within(decoder.maxBitDepth, video.bitDepth)
      && within(decoder.maxWidth, video.width)
      && within(decoder.maxHeight, video.height)
      // A source that states no Level is not judged on it (T8-23 D6).
      && withinWhenKnown(decoder.maxLevel, video.level)
      && within(decoder.maxFrameRate, video.frameRate, FRAME_RATE_SLACK);
  });
}

function targetVideoDecodes(video: NonNullable<EncodeTarget["video"]>, capabilities: Complete): boolean {
  return decodersOf(video.codec, capabilities).some((decoder) => withinWhenKnown(decoder.maxWidth, video.width)
    && withinWhenKnown(decoder.maxHeight, video.height)
    && withinWhenKnown(decoder.maxFrameRate, video.frameRate, FRAME_RATE_SLACK));
}

// A decoder, within its channel limit when one is stated for the codec, or a passthrough format; passthrough is not
// limited by the channel count, for the receiver decodes.
function audioPlayable(codecName: string | undefined, channels: number | undefined, capabilities: Complete, judgeChannels = true): boolean {
  const codec = codecName?.toLowerCase();
  if (!codec) return false;
  if (capabilities.audioDecoders.includes(codec as AudioCodec)) {
    const limit = judgeChannels ? capabilities.maxAudioChannels?.[codec as AudioCodec] : undefined;
    if (within(limit, channels)) return true;
  }
  return (PASSTHROUGH_FOR[codec] ?? []).some((format) => capabilities.passthrough.includes(format));
}
