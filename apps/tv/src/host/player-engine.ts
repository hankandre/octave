// The app's PlayerEngine (T8-01): the core's port over the player module's six native functions and its one event
// (apps/tv/src/host/player-module.android.ts). It copies a launch into the module's argument map key by key, so a
// field a caller added at run time does not cross, and it reads every answer and event back through the core's own
// readers. It builds no URL and sends nothing itself.
//
// Errors are the core's PlayerEngineError, built from a code alone. A rejection, a non-object, an unknown code or a
// missing shape becomes "unknown", and the native message, cause and stack are dropped.
import { readCapabilities } from "@octave/core/src/domain/player-capabilities";
import {
  PlayerEngineError,
  playerErrorCode,
  type LaunchRequest,
  type MediaTrack,
  type PlayerCapabilities,
  type PlayerEngine,
  type PlayerEvent,
} from "@octave/core/src/domain/player-engine";
import { playerEvent } from "@octave/core/src/player/player-event";

type NativeMap = Record<string, unknown>;

// The module's functions as the adapter calls them: at most one map in, one value out, which is checked before use.
export interface PlayerNative {
  initialize(): Promise<unknown>;
  launch(args: NativeMap): Promise<unknown>;
  setPaused(args: NativeMap): Promise<unknown>;
  seek(args: NativeMap): Promise<unknown>;
  selectTrack(args: NativeMap): Promise<unknown>;
  stop(): Promise<unknown>;
  addListener(eventName: "playerEvent", listener: (payload: unknown) => void): { remove(): void };
}

const FAILED: PlayerCapabilities = { probe: "failed" };

function isMap(value: unknown): value is NativeMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// {} resolves; { error } is that code's PlayerEngineError; anything else is "unknown".
function outcome(value: unknown): void {
  if (!isMap(value)) throw new PlayerEngineError("unknown");
  const keys = Object.keys(value);
  if (keys.length === 0) return;
  if (keys.length === 1 && keys[0] === "error") throw new PlayerEngineError(playerErrorCode(value.error));
  throw new PlayerEngineError("unknown");
}

async function command(call: () => Promise<unknown>): Promise<void> {
  let answer: unknown;
  try {
    answer = await call();
  } catch {
    throw new PlayerEngineError("unknown");
  }
  outcome(answer);
}

function trackArgs(track: MediaTrack): NativeMap {
  const args: NativeMap = { index: track.index, type: track.type, displayTitle: track.displayTitle, external: track.external };
  if (track.codec !== undefined) args.codec = track.codec;
  if (track.language !== undefined) args.language = track.language;
  if (track.deliveryUrl !== undefined) args.deliveryUrl = track.deliveryUrl;
  if (track.title !== undefined) args.title = track.title;
  if (track.channels !== undefined) args.channels = track.channels;
  if (track.isDefault !== undefined) args.isDefault = track.isDefault;
  if (track.isForced !== undefined) args.isForced = track.isForced;
  if (track.isHearingImpaired !== undefined) args.isHearingImpaired = track.isHearingImpaired;
  return args;
}

// The launch table of docs/specs/T8-01.md ("The launch request"), key by key.
function launchArgs(request: LaunchRequest): NativeMap {
  const args: NativeMap = {
    kind: request.kind,
    sessionId: request.sessionId,
    startPositionSeconds: request.startPositionSeconds,
    tracks: request.tracks.map(trackArgs),
  };
  if (request.audioStreamIndex !== undefined) args.audioStreamIndex = request.audioStreamIndex;
  if (request.subtitleStreamIndex !== undefined) args.subtitleStreamIndex = request.subtitleStreamIndex;
  switch (request.kind) {
    case "original":
      args.url = request.url;
      break;
    case "hls":
      args.masterUrl = request.masterUrl;
      args.serverUrl = request.serverUrl;
      args.mediaKind = request.mediaKind;
      break;
  }
  return args;
}

export function createPlayerEngine(native: PlayerNative): PlayerEngine {
  return {
    async initialize(): Promise<PlayerCapabilities> {
      try {
        return readCapabilities(await native.initialize());
      } catch {
        return FAILED;
      }
    },

    async subscribe(listener: (event: PlayerEvent) => void): Promise<() => void> {
      const subscription = native.addListener("playerEvent", (payload) => {
        const event = playerEvent(payload);
        if (event !== undefined) listener(event);
      });
      return () => subscription.remove();
    },

    launch: (request) => command(() => native.launch(launchArgs(request))),

    setPaused: (paused) => command(() => native.setPaused({ paused })),

    seek: (positionSeconds) => command(() => native.seek({ positionSeconds })),

    selectTrack: (type, playerId) => command(() => native.selectTrack(playerId === undefined ? { type } : { type, playerId })),

    stop: () => command(() => native.stop()),
  };
}
