// The device check on a conversion answer (T8-23, ARCHITECTURE.md §3 "Conversion answers are judged"). A conversion
// the core would hand to the engine is judged against the device first: what the server encodes into (the first codec
// of the rebuilt URL's list) and what it may copy. A target the device cannot decode is refused at once; a copy the
// device cannot play costs the one forced-conversion request, or, on the forced answer, is refused.
import {
  deviceDecodesTarget,
  devicePlayability,
  type EncodeTarget,
  type Playability,
} from "../domain/device-capabilities";
import type { PlayerCapabilities } from "../domain/player-engine";
import {
  audioFormat,
  codecList,
  judgedAudio,
  param,
  streamsOf,
  videoFormat,
  type SourceContext,
  type SourceDecision,
} from "./source-acceptance";
import type { MediaStreamDto } from "./types";

type Convert = Extract<SourceDecision, { kind: "convert" }>;
type Complete = Extract<PlayerCapabilities, { probe: "complete" }>;

// One stream of the conversion: what it is encoded into, and what it may copy.
interface Part {
  // The encode target's codec; undefined when the URL gives none to read (cannot tell), or when the URL says the
  // stream is copied (Jellyscale's VideoCodec=copy).
  target?: string;
  // Whether there is a target to judge.
  encodes: boolean;
  // Whether the server may copy the stream (PO ruling on D5: not turned off, and the URL's list holds the codec).
  copyPossible: boolean;
  // Whether the device plays every stream the server may copy; read only when copyPossible.
  copyPlayable: (capabilities: Complete) => boolean;
}

export function judgeConversion(decision: Convert, context: SourceContext, options: { forced: boolean }): SourceDecision {
  const capabilities = context.capabilities;
  if (capabilities === "full") return decision;
  const params = new URL(decision.masterUrl).searchParams;
  const video = decision.mediaKind === "videos" ? videoPart(decision, params) : undefined;
  const audio = audioPart(decision, params, context.audioStreamIndex);

  if (capabilities.probe === "complete") {
    // 1. A target the device cannot decode: asking again cannot change it (D2).
    const target: EncodeTarget = {
      ...(video?.encodes ? { video: { codec: video.target ?? "", ...videoTargetLimits(decision, params) } } : {}),
      ...(audio?.encodes ? { audio: { codec: audio.target ?? "" } } : {}),
    };
    const decodes = deviceDecodesTarget(target, capabilities);
    if (!decodes.video || !decodes.audio) return refused("conversion target not playable");
  }

  // 2. A possible copy the device cannot play. Under a failed probe a possible copy counts as not playable (D3).
  const cannotPlay: Playability = {
    video: video !== undefined && video.copyPossible && !playable(video, capabilities),
    audio: audio !== undefined && audio.copyPossible && !playable(audio, capabilities),
  };
  if (cannotPlay.video || cannotPlay.audio) {
    return options.forced ? refused("copied stream not playable") : { kind: "force-conversion", source: decision.source, cannotPlay };
  }
  // 3. Accept.
  return decision;
}

function playable(part: Part, capabilities: PlayerCapabilities): boolean {
  return capabilities.probe === "complete" && part.copyPlayable(capabilities);
}

function videoPart(decision: Convert, params: URLSearchParams): Part | undefined {
  const source = decision.source;
  const unprobed = (source.MediaStreams ?? []).length === 0;
  const [stream] = streamsOf(source, "Video");
  if (!unprobed && !stream) return undefined;
  const copyOff = param(params, "AllowVideoStreamCopy")?.toLowerCase() === "false";
  // The pinned Jellyscale says it copies the video with VideoCodec=copy; then there is no video target.
  if (param(params, "VideoCodec")?.toLowerCase() === "copy") {
    return {
      encodes: false,
      copyPossible: true,
      copyPlayable: (capabilities) => stream !== undefined && devicePlayability({ video: videoFormat(stream) }, capabilities).video,
    };
  }
  const list = codecList(params, "VideoCodec");
  if (unprobed) {
    // The copy can be any codec the URL lists, so every listed codec needs a decoder; limits are not judged (D4).
    return {
      target: list[0],
      encodes: true,
      copyPossible: !copyOff,
      copyPlayable: (capabilities) => list.length > 0
        && list.every((codec) => capabilities.videoDecoders.some((decoder) => decoder.codec === codec)),
    };
  }
  return {
    target: list[0],
    encodes: true,
    copyPossible: !copyOff && holds(list, stream),
    copyPlayable: (capabilities) => devicePlayability({ video: videoFormat(stream) }, capabilities).video,
  };
}

function audioPart(decision: Convert, params: URLSearchParams, requestIndex: number | undefined): Part | undefined {
  const source = decision.source;
  const unprobed = (source.MediaStreams ?? []).length === 0;
  if (!unprobed && streamsOf(source, "Audio").length === 0) return undefined;
  const copyOff = param(params, "AllowAudioStreamCopy")?.toLowerCase() === "false";
  const list = codecList(params, "AudioCodec");
  if (unprobed) {
    return {
      target: list[0],
      encodes: true,
      copyPossible: !copyOff,
      copyPlayable: (capabilities) => list.length > 0
        && list.every((codec) => devicePlayability({ audio: { codec } }, capabilities).audio),
    };
  }
  // The copied audio: the stream the URL names, else the request's, else the source's default, else the first.
  const urlIndex = Number(param(params, "AudioStreamIndex"));
  const named = Number.isInteger(urlIndex) ? streamsOf(source, "Audio").find((candidate) => candidate.Index === urlIndex) : undefined;
  const stream = named ?? judgedAudio(source, requestIndex);
  return {
    target: list[0],
    encodes: true,
    copyPossible: !copyOff && stream !== undefined && holds(list, stream),
    copyPlayable: (capabilities) => stream !== undefined && devicePlayability({ audio: audioFormat(stream) }, capabilities).audio,
  };
}

// The URL's list holds the stream's codec; a stream that states no codec counts as held (cannot tell is never can
// play). An empty list holds nothing: there is no copy, and the target is cannot tell.
function holds(list: readonly string[], stream: MediaStreamDto): boolean {
  const codec = stream.Codec?.trim().toLowerCase();
  if (!codec) return true;
  return list.includes(codec);
}

// The target's size and frame rate: the source's first video stream's, lowered by the URL's limits. A value neither
// gives is not judged.
function videoTargetLimits(decision: Convert, params: URLSearchParams): { width?: number; height?: number; frameRate?: number } {
  const [stream] = streamsOf(decision.source, "Video");
  const width = lowest(stream?.Width, param(params, "MaxWidth"));
  const height = lowest(stream?.Height, param(params, "MaxHeight"));
  const frameRate = lowest(stream?.ReferenceFrameRate, param(params, "MaxFramerate"));
  return {
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(frameRate !== undefined ? { frameRate } : {}),
  };
}

function lowest(source: number | null | undefined, limit: string | undefined): number | undefined {
  const values = [source ?? undefined, limit === undefined ? undefined : Number(limit)]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  return values.length === 0 ? undefined : Math.min(...values);
}

function refused(detail: string): SourceDecision {
  return { kind: "refused", reason: "device-cannot-play", detail };
}
