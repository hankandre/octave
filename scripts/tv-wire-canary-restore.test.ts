// @vitest-environment node
// T4-05 (item 6, issue 8): transport-canary's line carries two fixed words about restoreSessions. The judge passes them
// only as restore=listed and after-logout=absent, and still passes a line from before T4-05, which holds neither.
import { describe, expect, it } from "vitest";
import { judgeWire } from "./tv-wire-judge.mjs";

const PAIR = { test: "transport-canary", target: "mock", task: "T3-05", requests: 6, canaryOrigin: 0 };
const LINE = "OCTAVE_WIRE result test=transport-canary target=mock task=T3-05 crossings=68 selftest=ok canary=absent restore=listed after-logout=absent";
const DONE = "OCTAVE_WIRE done";

const judge = (line: string) => judgeWire({ pairs: [PAIR], lines: [line, DONE] });

describe("T4-05: transport-canary's restore words", () => {
  it("passes restore=listed and after-logout=absent, and a line with neither", () => {
    expect(judge(LINE)).toEqual([]);
    expect(judge(LINE.replace(" restore=listed after-logout=absent", ""))).toEqual([]);
  });

  it.each([
    ["restore=listed", "restore=missing", /did not list the signed-in session/],
    ["restore=listed", "restore=not-run", /did not list the signed-in session/],
    ["after-logout=absent", "after-logout=present", /still listed the session after the logout/],
    ["after-logout=absent", "after-logout=not-run", /still listed the session after the logout/],
  ])("fails %s written as %s", (from, to, cause) => {
    expect(judge(LINE.replace(from, to)).join("\n")).toMatch(cause);
  });
});
