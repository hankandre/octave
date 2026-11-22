// pnpm tv:wire's guard against a dropped adb connection (T3-05, CI follow-up). Every adb reverse lives on it, so a drop
// mid-run takes them all and the app's later calls fail as network errors (CI run 45002313854: after the stalled call
// no request reached any recorder; `adb reconnect device` mid-run reproduces it). The runner waits until adbd has run
// for ADBD_STEADY_S before it reverses anything, and voids a run whose adbd changed or whose reverses are gone at its
// end, running it once more.
import { describe, expect, it } from "vitest";
import { ADBD_STEADY_S, adbdOf, adbRestartErrors, missingReverses, resumedPackage } from "./tv-wire.mjs";

const PS = ["  PID ELAPSED NAME", "    1   04:12 init", " 1561   01:06 adbd", " 1700   00:02 sh"].join("\n");

describe("tv:wire adbd guard", () => {
  it("reads adbd's pid and elapsed seconds from ps, in every ELAPSED form", () => {
    expect(adbdOf(PS)).toEqual({ pid: 1561, elapsed: 66 });
    expect(adbdOf(" 42 02:03:04 adbd")).toEqual({ pid: 42, elapsed: 2 * 3600 + 3 * 60 + 4 });
    expect(adbdOf(" 42 1-00:00:05 adbd")).toEqual({ pid: 42, elapsed: 86_405 });
  });

  it("finds no adbd in output without one, in an error, or under another name", () => {
    expect(adbdOf("")).toBeNull();
    expect(adbdOf("adb: device offline")).toBeNull();
    expect(adbdOf(" 7 01:00 adbd-helper\n 8 01:00 notadbd")).toBeNull();
  });

  it("waits for a steady daemon of at least a minute", () => {
    expect(ADBD_STEADY_S).toBeGreaterThanOrEqual(60);
  });

  it("lists the reversed device ports that adb reverse --list no longer shows", () => {
    const list = "host-19 tcp:47300 tcp:39211\nhost-19 tcp:47401 tcp:40001\n";
    expect(missingReverses(list, [47300, 47401])).toEqual([]);
    expect(missingReverses(list, [47300, 47307, 47401])).toEqual([47307]);
    expect(missingReverses("\n", [47300])).toEqual([47300]);
    expect(missingReverses("host-19 tcp:473001 tcp:1\n", [47300])).toEqual([47300]);
  });

  it("voids the run when adbd restarted, vanished, or a reverse is gone, and passes a steady run", () => {
    const steady = { pid: 1561, elapsed: 70 };
    expect(adbRestartErrors({ before: steady, after: { pid: 1561, elapsed: 110 }, missing: [], reversed: 10 })).toEqual([]);
    expect(adbRestartErrors({ before: steady, after: { pid: 1990, elapsed: 5 }, missing: [], reversed: 10 })[0]).toMatch(/adb daemon restarted/);
    expect(adbRestartErrors({ before: steady, after: null, missing: [], reversed: 10 })[0]).toMatch(/adb daemon restarted/);
    expect(adbRestartErrors({ before: steady, after: { pid: 1561, elapsed: 110 }, missing: [47307], reversed: 10 })).toEqual([
      expect.stringMatching(/1 of 10 adb reverse\(s\) were gone/),
    ]);
  });
});

describe("tv:wire resumed package", () => {
  it("names the top resumed activity's package, or unknown", () => {
    const dumpsys = "  topResumedActivity=ActivityRecord{48353377 u0 com.google.android.tvlauncher/.MainActivity t5}\n";
    expect(resumedPackage(dumpsys)).toBe("com.google.android.tvlauncher");
    expect(resumedPackage("")).toBe("unknown");
  });
});
