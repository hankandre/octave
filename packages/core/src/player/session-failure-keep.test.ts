import { describe, expect, it, vi } from "vitest";
import { reportingWarningAction } from "./session-failure";
import { initialPlaybackSessionState, playbackSessionReducer } from "./session-state";

describe("a reporting message that is not a code", () => {
  it("keeps the warning the state already holds", () => {
    const log = vi.fn();
    const held = playbackSessionReducer(initialPlaybackSessionState, reportingWarningAction("report-failed", log));
    const after = playbackSessionReducer(held, reportingWarningAction("Stopping the server conversion failed.", log));
    expect(after.reportingWarning).toBe("report-failed");
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("still clears the warning when the message is undefined", () => {
    const held = playbackSessionReducer(initialPlaybackSessionState, { type: "reporting-warning", code: "report-failed" });
    expect(playbackSessionReducer(held, reportingWarningAction(undefined, vi.fn())).reportingWarning).toBeUndefined();
  });

  it("sends only filtered text to the log", () => {
    const log = vi.fn();
    reportingWarningAction("DELETE failed at http://jellyfin.home.lan:8096/x?PlaySessionId=abc", log);
    const text = String(log.mock.calls[0]?.[0]);
    expect(text).not.toContain("jellyfin.home.lan");
    expect(text).not.toContain("abc");
  });
});
