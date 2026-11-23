import type { PlayerErrorCode } from "./player-engine";

// The closed list of failures a screen can show. Each code names one row of DESIGN.md §10's copy table.
export const PLAYBACK_FAILURE_CODES = [
  "server-unreachable",
  "server-error",
  "stop-failed",
  "unsafe-stream",
  "request-failed",
  "session-ended",
  "decoder-unavailable",
  "audio-output-failed",
] as const;
export type PlaybackFailureCode = (typeof PLAYBACK_FAILURE_CODES)[number];

export const REPORTING_WARNING_CODES = ["report-failed"] as const;
export type ReportingWarningCode = (typeof REPORTING_WARNING_CODES)[number];

// `row` is the State cell of the DESIGN.md row; title, body and actions are copied from it verbatim.
export interface FailureCopy {
  row: string;
  title?: string;
  body: string;
  actions: readonly string[];
}

export const PLAYBACK_FAILURE_COPY: Record<PlaybackFailureCode | ReportingWarningCode, FailureCopy> = {
  "server-unreachable": {
    row: "Playback error, server unreachable (no response, network error, timeout)",
    title: "Playback could not start",
    body: "Couldn't reach {server}. Check that the server is on, then try again.",
    actions: ["Retry", "Back to details"],
  },
  "server-error": {
    row: "Playback error, server error (HTTP 5xx)",
    title: "Playback could not start",
    body: "{server} had a problem starting playback. Try again in a moment.",
    actions: ["Retry", "Back to details"],
  },
  "stop-failed": {
    row: "Playback error, the player did not stop (Back, Retry, or a track or limit change; owner decision 2026-11-19)",
    title: "Couldn't stop playback",
    body: "The player didn't close properly. Go back to try again, or quit Octave if you can still hear it.",
    actions: ["Back to details"],
  },
  "unsafe-stream": {
    row: "Playback error, unsafe stream",
    title: "Playback could not start",
    body: "Your server offered a stream address Octave won't use.",
    actions: ["Back to details"],
  },
  "request-failed": {
    row: "Playback error, other request failure",
    title: "Playback could not start",
    body: "Something went wrong starting playback. Try again.",
    actions: ["Retry", "Back to details"],
  },
  "session-ended": {
    row: "Playback error, session ended",
    title: "Playback stopped",
    body: "Your session on {server} has ended. Sign in again to keep watching.",
    actions: ["Sign in", "Back to details"],
  },
  "decoder-unavailable": {
    row: "Playback error, format not supported on this device",
    title: "Playback stopped",
    body: "This device can't play this video or audio format.",
    actions: ["Back to details"],
  },
  "audio-output-failed": {
    row: "Playback error, audio output failed",
    title: "Playback stopped",
    body: "Couldn't play the sound on this device. Check the TV's audio output, then try again.",
    actions: ["Retry", "Back to details"],
  },
  "report-failed": {
    row: "Progress report failed",
    body: "Couldn't save your progress to {server}. Playback continues.",
    actions: [],
  },
};

const PLAYER_ERROR_FAILURES: Record<PlayerErrorCode, PlaybackFailureCode> = {
  "network": "server-unreachable",
  "server-error": "server-error",
  "session-ended": "session-ended",
  "unsafe-playlist": "unsafe-stream",
  "unsupported-request": "request-failed",
  "malformed-media": "request-failed",
  "decoder-unavailable": "decoder-unavailable",
  "decoder-failed": "request-failed",
  "audio-output-failed": "audio-output-failed",
  "stop-failed": "stop-failed",
  "unknown": "request-failed",
};

export function playbackFailureForPlayerError(code: PlayerErrorCode): PlaybackFailureCode {
  return PLAYER_ERROR_FAILURES[code];
}
