// T8-25 item 1: a failure in the state a screen reads is one code from a closed list, chosen from the error's class
// and typed code fields, never from message text. (docs/specs/T8-25.md, Acceptance 1.)
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { PlaybackRefusedError } from "../domain/playback";
import type { PlaybackFailureCode, ReportingWarningCode } from "../domain/playback-failure";
import { PLAYBACK_FAILURE_CODES, REPORTING_WARNING_CODES, playbackFailureForPlayerError } from "../domain/playback-failure";
import { PLAYER_ERROR_CODES, PlayerEngineError, type PlayerEvent } from "../domain/player-engine";
import { PlaybackCancelledError, PlayerStopError } from "./coordinator";
import { LaunchRefusedError } from "./launch-request";
import { playbackFailureCode, failureAction, reportingWarningAction, stopFailureAction } from "./session-failure";
import { initialPlaybackSessionState, playbackSessionReducer, type PlaybackSessionState } from "./session-state";

const STATE_KEYS = ["snapshot", "firstFrameReady", "failure", "reportingWarning"];

function transportError(code: string, status: number | undefined, message: string): Error {
  return Object.assign(new Error(message), status === undefined ? { code } : { code, status });
}

describe("T8-25 item 1: the state's types", () => {
  it("T8-25 item 1: failure and reportingWarning hold only their closed lists", () => {
    expectTypeOf<PlaybackSessionState["failure"]>().toEqualTypeOf<PlaybackFailureCode | undefined>();
    expectTypeOf<PlaybackSessionState["reportingWarning"]>().toEqualTypeOf<ReportingWarningCode | undefined>();
    expect(PLAYBACK_FAILURE_CODES).toContain("request-failed");
    expect(REPORTING_WARNING_CODES).toEqual(["report-failed"]);
  });
});

describe("T8-25 item 1: which code for which error", () => {
  const refusal = new PlaybackRefusedError({ reason: "device-cannot-play" });
  const unsafe = new PlaybackRefusedError({ reason: "unsafe-transcoding-url", detail: "host" });
  it.each<[string, unknown, PlaybackFailureCode]>([
    ["a failed stop", new PlayerStopError(), "stop-failed"],
    ["a refused launch address", new LaunchRefusedError(), "unsafe-stream"],
    ["an unsafe transcoding URL refusal", unsafe, "unsafe-stream"],
    ["any other refusal", refusal, "request-failed"],
    ["a network transport error", transportError("network", undefined, "x"), "server-unreachable"],
    ["a timeout transport error", transportError("timeout", undefined, "x"), "server-unreachable"],
    ["a 5xx transport error", transportError("status", 503, "x"), "server-error"],
    ["a 4xx transport error", transportError("status", 404, "x"), "request-failed"],
    ["a refused transport error", transportError("refused", undefined, "x"), "request-failed"],
    ["a plain Error", new Error("anything"), "request-failed"],
    ["a string", "anything", "request-failed"],
    ["a cancelled attempt", new PlaybackCancelledError(), "request-failed"],
  ])("T8-25 item 1: %s gives its code", (_name, error, code) => {
    expect(playbackFailureCode(error)).toBe(code);
  });

  it.each(PLAYER_ERROR_CODES.map((code) => [code] as const))("T8-25 item 1: an engine error with code %s gives that code's failure", (code) => {
    expect(playbackFailureCode(new PlayerEngineError(code))).toBe(playbackFailureForPlayerError(code));
  });

  it("T8-25 item 1: an engine code outside the list gives the code of unknown", () => {
    const forged = Object.create(PlayerEngineError.prototype) as PlayerEngineError;
    Object.defineProperty(forged, "code", { value: "bogus" });
    expect(playbackFailureCode(forged)).toBe(playbackFailureForPlayerError("unknown"));
  });

  it("T8-25 item 1: the same class with different messages gives the same code", () => {
    const messages = ["one", "connect to nas failed", "https://media.test/x?api_key=SECRET-TOKEN", ""];
    for (const build of [
      (m: string) => new Error(m),
      (m: string) => transportError("network", undefined, m),
      (m: string) => transportError("status", 500, m),
      (m: string) => Object.assign(new PlayerStopError(), { message: m }),
      (m: string) => Object.assign(new PlayerEngineError("network"), { message: m }),
      (m: string) => Object.assign(new LaunchRefusedError(), { message: m }),
    ]) {
      const codes = new Set(messages.map((m) => playbackFailureCode(build(m))));
      expect(codes.size).toBe(1);
    }
  });
});

describe("T8-25 item 1: the state after hostile input", () => {
  const text = "cannot open /home/u/My Movies via https://media.test/x?api_key=SECRET-TOKEN aa:bb:cc:dd:ee:ff";
  const altered = new PlayerEngineError("network");
  altered.message = text;

  function reduceAll(actions: Parameters<typeof playbackSessionReducer>[1][]): PlaybackSessionState {
    return actions.reduce(playbackSessionReducer, initialPlaybackSessionState);
  }

  it("T8-25 item 1: every action kind leaves only the four keys and values from the lists", () => {
    const log = vi.fn();
    const bogusEvent = { kind: "error", code: text, message: text } as unknown as PlayerEvent;
    const steps = [
      { type: "event", event: bogusEvent },
      { type: "event", event: { kind: "error", code: "decoder-failed" } },
      failureAction(text, log),
      failureAction(new Error(text), log),
      failureAction(altered, log),
      failureAction(new PlaybackRefusedError({ reason: "device-cannot-play", detail: text }), log),
      stopFailureAction(),
      reportingWarningAction("report-failed", log),
      reportingWarningAction(text, log),
      reportingWarningAction(undefined, log),
      { type: "reporting-warning", code: "report-failed" },
      { type: "event", event: { kind: "first-frame" } },
    ] as Parameters<typeof playbackSessionReducer>[1][];
    let state = initialPlaybackSessionState;
    for (const step of steps) {
      state = playbackSessionReducer(state, step);
      for (const key of Object.keys(state)) expect(STATE_KEYS, `unexpected state key ${key}`).toContain(key);
      if (state.failure !== undefined) expect(PLAYBACK_FAILURE_CODES).toContain(state.failure);
      if (state.reportingWarning !== undefined) expect(REPORTING_WARNING_CODES).toContain(state.reportingWarning);
      expect(JSON.stringify(state)).not.toContain("SECRET-TOKEN");
      expect(JSON.stringify(state)).not.toContain("Movies");
    }
    expect(reduceAll(steps).firstFrameReady).toBe(true);
  });

  it("T8-25 item 1: a failure action carries its type and code and no other field", () => {
    const action = failureAction(new Error(text), vi.fn());
    expect(action).toEqual({ type: "failure", code: "request-failed" });
    expect(stopFailureAction()).toEqual({ type: "failure", code: "stop-failed" });
  });

  it("T8-25 item 1: a reporting warning action carries only a code or nothing", () => {
    const log = vi.fn();
    expect(reportingWarningAction(undefined, log)).toEqual({ type: "reporting-warning" });
    expect(reportingWarningAction("report-failed", log)).toEqual({ type: "reporting-warning", code: "report-failed" });
    expect(reportingWarningAction("report-failed", log)).not.toHaveProperty("message");
    const other = reportingWarningAction(text, log);
    expect(other.type).toBe("reporting-warning");
    expect(JSON.stringify(other)).not.toContain("Movies");
    expect(other).not.toHaveProperty("message");
  });
});
