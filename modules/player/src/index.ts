// The player module's JavaScript surface (T8-01): the PlayerEngine port's six commands, its one event, playerEvent
// (the port's subscribe), and one native view with no prop. Types only: the one place that loads the native module is
// the app's apps/tv/src/host/player-module.android.ts, the one place that loads the view is
// apps/tv/src/host/player-view.android.tsx, and the app's adapter (apps/tv/src/host/player-engine.ts) turns these
// functions into the core's PlayerEngine port. No argument is a header, a token or a free-form option. Every outcome is
// a value; a function does not reject on purpose. The shapes are written here, as the session module's are, so the
// package depends on nothing; the adapter checks every answer against the core's own types.

// A failure: one of the port's PLAYER_ERROR_CODES.
export interface PlayerFailure {
  readonly error: string;
}

export type PlayerOutcome = Record<string, never> | PlayerFailure;

// The port's MediaTrack, field for field.
export interface TrackArgs {
  readonly index: number;
  readonly type: "Audio" | "Subtitle" | "Video";
  readonly displayTitle: string;
  readonly external: boolean;
  readonly codec?: string;
  readonly language?: string;
  readonly deliveryUrl?: string;
  readonly title?: string;
  readonly channels?: number;
  readonly isDefault?: boolean;
  readonly isForced?: boolean;
  readonly isHearingImpaired?: boolean;
}

interface LaunchArgsCommon {
  readonly sessionId: string;
  readonly startPositionSeconds: number;
  readonly tracks: readonly TrackArgs[];
  readonly audioStreamIndex?: number;
  readonly subtitleStreamIndex?: number;
}

// The launch table of docs/specs/T8-01.md ("The launch request"); Kotlin refuses any other key.
export type LaunchArgs =
  | (LaunchArgsCommon & { readonly kind: "original"; readonly url: string })
  | (LaunchArgsCommon & { readonly kind: "hls"; readonly masterUrl: string; readonly serverUrl: string; readonly mediaKind: "videos" | "audio" });

export interface SetPausedArgs {
  readonly paused: boolean;
}

export interface SeekArgs {
  readonly positionSeconds: number;
}

export interface SelectTrackArgs {
  readonly type: "audio" | "subtitle";
  readonly playerId?: number;
}

export interface PlayerEventSubscription {
  remove(): void;
}

// The native module, as apps/tv/src/host/player-module.android.ts loads it. The capability answer and a playerEvent
// payload are unread data: the adapter rebuilds them through the core's readCapabilities and playerEvent.
export interface OctavePlayerNative {
  initialize(): Promise<unknown>;
  launch(args: LaunchArgs): Promise<PlayerOutcome>;
  setPaused(args: SetPausedArgs): Promise<PlayerOutcome>;
  seek(args: SeekArgs): Promise<PlayerOutcome>;
  selectTrack(args: SelectTrackArgs): Promise<PlayerOutcome>;
  stop(): Promise<PlayerOutcome>;
  addListener(eventName: "playerEvent", listener: (payload: unknown) => void): PlayerEventSubscription;
}
