// The app's PlayerEngine (T8-01): the core's port over the player module's six native functions and its one event
// (apps/tv/src/host/player-module.android.ts). It copies a launch into the module's argument map key by key, so a
// field a caller added at run time does not cross, and it reads every answer and event back through the core's own
// readers. It builds no URL and sends nothing itself. The argument shapes are the module's own types.
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
import type { LaunchArgs, OctavePlayerNative, SeekArgs, SelectTrackArgs, SetPausedArgs, TrackArgs } from "@octave/player";

type NativeMap = Record<string, unknown>;

// The module's functions as the adapter calls them. Each answer is checked before use, whatever its declared type.
export type PlayerNative = OctavePlayerNative;

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

function trackArgs(track: MediaTrack): TrackArgs {
  const { codec, language, deliveryUrl, title, channels, isDefault, isForced, isHearingImpaired } = track;
  return {
    index: track.index,
    type: track.type,
    displayTitle: track.displayTitle,
    external: track.external,
    ...(codec === undefined ? {} : { codec }),
    ...(language === undefined ? {} : { language }),
    ...(deliveryUrl === undefined ? {} : { deliveryUrl }),
    ...(title === undefined ? {} : { title }),
    ...(channels === undefined ? {} : { channels }),
    ...(isDefault === undefined ? {} : { isDefault }),
    ...(isForced === undefined ? {} : { isForced }),
    ...(isHearingImpaired === undefined ? {} : { isHearingImpaired }),
  };
}

// The launch table of docs/specs/T8-01.md ("The launch request"), key by key.
function launchArgs(request: LaunchRequest): LaunchArgs {
  const { audioStreamIndex, subtitleStreamIndex } = request;
  const common = {
    sessionId: request.sessionId,
    startPositionSeconds: request.startPositionSeconds,
    tracks: request.tracks.map(trackArgs),
    ...(audioStreamIndex === undefined ? {} : { audioStreamIndex }),
    ...(subtitleStreamIndex === undefined ? {} : { subtitleStreamIndex }),
  };
  switch (request.kind) {
    case "original":
      return { ...common, kind: "original", url: request.url };
    case "hls":
      return { ...common, kind: "hls", masterUrl: request.masterUrl, serverUrl: request.serverUrl, mediaKind: request.mediaKind };
  }
}

function selectTrackArgs(type: SelectTrackArgs["type"], playerId: number | undefined): SelectTrackArgs {
  return playerId === undefined ? { type } : { type, playerId };
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

    setPaused: (paused) => command(() => native.setPaused({ paused } satisfies SetPausedArgs)),

    seek: (positionSeconds) => command(() => native.seek({ positionSeconds } satisfies SeekArgs)),

    selectTrack: (type, playerId) => command(() => native.selectTrack(selectTrackArgs(type, playerId))),

    stop: () => command(() => native.stop()),
  };
}
