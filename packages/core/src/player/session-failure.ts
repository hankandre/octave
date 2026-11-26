import { PlaybackRefusedError } from "../domain/playback";
import type { PlaybackFailureCode, ReportingWarningCode } from "../domain/playback-failure";
import { REPORTING_WARNING_CODES, playbackFailureForPlayerError } from "../domain/playback-failure";
import { PlayerEngineError, playerErrorCode } from "../domain/player-engine";
import type { FailureLog } from "../ports/failure-log";
import { errorReason } from "../safe-reason";
import { classifyTransportError } from "../transport-error";
import { PlayerStopError } from "./coordinator";
import { LaunchRefusedError } from "./launch-request";
import type { PlaybackSessionAction } from "./session-state";

// Picks the failure code from the error's class and typed fields only, never from its message.
export function playbackFailureCode(error: unknown): PlaybackFailureCode {
  if (error instanceof PlayerStopError) return "stop-failed";
  if (error instanceof LaunchRefusedError) return "unsafe-stream";
  if (error instanceof PlaybackRefusedError) {
    return error.reason === "unsafe-transcoding-url" ? "unsafe-stream" : "request-failed";
  }
  if (error instanceof PlayerEngineError) return playbackFailureForPlayerError(playerErrorCode(error.code));
  switch (classifyTransportError(error)) {
    case "network":
      return "server-unreachable";
    case "server":
      return "server-error";
    case "request":
    case undefined:
      return "request-failed";
  }
}

// The filtered native reason goes to the log sink and nowhere else.
export function logFailure(error: unknown, log: FailureLog): void {
  log(errorReason(error, "Something went wrong."));
}

// The action holds only the code.
export function failureAction(error: unknown, log: FailureLog): PlaybackSessionAction {
  logFailure(error, log);
  return { type: "failure", code: playbackFailureCode(error) };
}

export function stopFailureAction(): PlaybackSessionAction {
  return { type: "failure", code: "stop-failed" };
}

// A message that is not a ReportingWarningCode goes, filtered, to the log and leaves the state's warning as it was.
export function reportingWarningAction(message: string | undefined, log: FailureLog): PlaybackSessionAction {
  if (message === undefined) return { type: "reporting-warning" };
  if ((REPORTING_WARNING_CODES as readonly string[]).includes(message)) {
    return { type: "reporting-warning", code: message as ReportingWarningCode };
  }
  log(errorReason(message, "Something went wrong."));
  return { type: "reporting-warning", unchanged: true };
}
