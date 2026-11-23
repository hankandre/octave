import type { PlaybackSnapshot, PlayerEvent } from "../domain/playback";
import { playerErrorCode } from "../domain/playback";
import type { PlaybackFailureCode, ReportingWarningCode } from "../domain/playback-failure";
import { playbackFailureForPlayerError } from "../domain/playback-failure";

export interface PlaybackSessionState {
  snapshot?: PlaybackSnapshot;
  firstFrameReady: boolean;
  failure?: PlaybackFailureCode;
  reportingWarning?: ReportingWarningCode;
}

export type PlaybackSessionAction =
  | { type: "reset" }
  | { type: "event"; event: PlayerEvent }
  | { type: "failure"; code: PlaybackFailureCode }
  | { type: "reporting-warning"; code?: ReportingWarningCode };

export const initialPlaybackSessionState: PlaybackSessionState = {
  firstFrameReady: false,
};

export function playbackSessionReducer(
  state: PlaybackSessionState,
  action: PlaybackSessionAction,
): PlaybackSessionState {
  switch (action.type) {
    case "reset":
      return initialPlaybackSessionState;
    case "failure":
      return { ...state, failure: action.code };
    case "reporting-warning":
      return { ...state, reportingWarning: action.code };
    case "event":
      return reducePlayerEvent(state, action.event);
  }
}

function reducePlayerEvent(state: PlaybackSessionState, event: PlayerEvent): PlaybackSessionState {
  switch (event.kind) {
    case "first-frame":
      return { ...state, firstFrameReady: true };
    case "error": {
      return { ...state, failure: playbackFailureForPlayerError(playerErrorCode(event.code)) };
    }
    case "ended":
      return { ...state, snapshot: event.snapshot ?? state.snapshot };
    case "loaded":
    case "state":
    case "tracks-changed":
      return {
        ...state,
        snapshot: event.snapshot,
      };
  }
}
