import { describe, expect, it } from "vitest";
import type { PlaybackSnapshot } from "../domain/playback";
import { playbackFailureForPlayerError } from "../domain/playback-failure";
import { initialPlaybackSessionState, playbackSessionReducer } from "./session-state";

const snapshot: PlaybackSnapshot = {
  positionSeconds: 31,
  paused: false,
  buffering: true,
  volume: 100,
  muted: false,
  tracks: [],
  diagnostics: { decodeMode: "hardware", decodeLabel: "Hardware — VA-API", droppedFrames: 2 },
};

describe("playbackSessionReducer", () => {
  it("retains snapshot, first-frame readiness, and errors independently", () => {
    let state = playbackSessionReducer(initialPlaybackSessionState, { type: "reset" });
    state = playbackSessionReducer(state, { type: "event", event: { kind: "first-frame" } });
    state = playbackSessionReducer(state, { type: "event", event: { kind: "state", snapshot } });
    state = playbackSessionReducer(state, { type: "event", event: { kind: "error", code: "decoder-failed" } });
    state = playbackSessionReducer(state, {
      type: "event",
      event: { kind: "ended", snapshot: { ...snapshot, buffering: false }, reason: "error" },
    });

    expect(state).toMatchObject({
      firstFrameReady: true,
      // The failure code for the engine's code, never player text (T2-05) and no text at all (T8-25).
      failure: playbackFailureForPlayerError("decoder-failed"),
      snapshot: { positionSeconds: 31 },
    });
    expect(state.snapshot?.buffering).toBe(false);
    expect(state.snapshot?.diagnostics).toEqual(snapshot.diagnostics);
  });

  it("marks a failed stop, and a later player error clears the mark", () => {
    let state = playbackSessionReducer(initialPlaybackSessionState, { type: "failure", code: "stop-failed" });
    expect(state).toMatchObject({ failure: "stop-failed" });
    state = playbackSessionReducer(state, { type: "event", event: { kind: "error", code: "decoder-failed" } });
    expect(state.failure).toBe(playbackFailureForPlayerError("decoder-failed"));
    expect(state.failure).not.toBe("stop-failed");
    state = playbackSessionReducer(state, { type: "failure", code: "server-unreachable" });
    expect(state.failure).toBe("server-unreachable");
  });

  it("does not discard diagnostics when a first-frame event arrives after state", () => {
    let state = playbackSessionReducer(initialPlaybackSessionState, {
      type: "event",
      event: { kind: "loaded", snapshot },
    });
    state = playbackSessionReducer(state, { type: "event", event: { kind: "first-frame" } });
    expect(state.snapshot?.diagnostics).toEqual(snapshot.diagnostics);
    expect(state.snapshot).toEqual(snapshot);
  });
});
