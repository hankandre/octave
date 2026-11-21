// @vitest-environment node
// T3-01 acceptance item 4: the app starts on an Android TV emulator and its first screen takes focus from the D-pad
// without a priming press. The oracle is the pure judgeFirstFocus(lines) over the transcript scripts/tv-first-focus.mjs
// records; the tv job runs that script in its emulator step.
//
// Transcript lines (the script writes them in this order):
// - `OCTAVE_RESOLVE <component>`: the last line of `cmd package resolve-activity --brief -c
//   android.intent.category.LEANBACK_LAUNCHER <id>`, written by the script before `am start`.
// - logcat lines, in whatever column format logcat prints: a focus line has the tag `ReactNativeJS` and the message
//   `OCTAVE_FOCUS tile-<n>`; the press marker has the tag `OCTAVE_PRESS` and the message `1 RIGHT`. The judge reads the
//   tag and the message, not the time, pid or priority columns.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

type JudgeFirstFocus = (lines: string[]) => string[];

async function loadJudge(): Promise<JudgeFirstFocus> {
  const module = (await import("./tv-first-focus.mjs")) as { judgeFirstFocus: JudgeFirstFocus };
  return module.judgeFirstFocus;
}

const RESOLVED = "OCTAVE_RESOLVE dev.octave.tv/.MainActivity";
// `adb logcat` default (threadtime) format.
const focus = (tile: number, time = "10:00:01.000") => `11-21 ${time}  4321  4377 I ReactNativeJS: OCTAVE_FOCUS tile-${tile}`;
const press = (time = "10:00:02.000") => `11-21 ${time}  5000  5000 I OCTAVE_PRESS: 1 RIGHT`;
const noise = "11-21 10:00:00.500  4321  4377 I ReactNativeJS: Running \"main\" with {\"rootTag\":11}";

function expectFailure(errors: string[], reason: RegExp): void {
  expect(errors.length).toBeGreaterThanOrEqual(1);
  expect(errors[0]).toMatch(/^ERROR tv focus: /);
  expect(errors.join("\n")).toMatch(reason);
}

describe("judgeFirstFocus", () => {
  it("T3-01 item 4: passes tile-0 focused before the one press and tile-1 first after it", async () => {
    const judge = await loadJudge();
    expect(judge([RESOLVED, noise, focus(0), press(), focus(1, "10:00:02.300")])).toEqual([]);
  });

  it("T3-01 item 4: reads tag and message, not the columns (logcat -v epoch)", async () => {
    const judge = await loadJudge();
    const lines = [
      RESOLVED,
      "     1795255201.000  4321  4377 I ReactNativeJS: OCTAVE_FOCUS tile-0",
      "     1795255202.000  5000  5000 I OCTAVE_PRESS: 1 RIGHT",
      "     1795255202.300  4321  4377 I ReactNativeJS: OCTAVE_FOCUS tile-1",
    ];
    expect(judge(lines)).toEqual([]);
  });

  it("T3-01 item 4: fails a priming press: the first focus line comes only after the press", async () => {
    const judge = await loadJudge();
    expectFailure(judge([RESOLVED, noise, press(), focus(0, "10:00:02.300")]), /priming|before the press/i);
  });

  it("T3-01 item 4: fails a priming press even when a later line reaches tile-1", async () => {
    const judge = await loadJudge();
    expectFailure(judge([RESOLVED, press(), focus(0, "10:00:02.300"), focus(1, "10:00:02.400")]), /priming|before the press/i);
  });

  it("T3-01 item 4: fails when the press leaves focus on tile-0", async () => {
    const judge = await loadJudge();
    expectFailure(judge([RESOLVED, focus(0), press()]), /tile-1/);
  });

  it("T3-01 item 4: fails when the first focus line after the press is not tile-1", async () => {
    const judge = await loadJudge();
    expectFailure(judge([RESOLVED, focus(0), press(), focus(2, "10:00:02.300"), focus(1, "10:00:02.400")]), /tile-1/);
  });

  it("T3-01 item 4: fails when no focus line arrives", async () => {
    const judge = await loadJudge();
    expectFailure(judge([RESOLVED, noise, press()]), /no focus/i);
  });

  it("T3-01 item 4: fails a transcript with more than one press", async () => {
    const judge = await loadJudge();
    expectFailure(judge([RESOLVED, focus(0), press(), focus(1, "10:00:02.300"), press("10:00:03.000"), focus(2, "10:00:03.300")]), /one press/i);
  });

  it("T3-01 item 4: fails a transcript with no press", async () => {
    const judge = await loadJudge();
    expectFailure(judge([RESOLVED, focus(0)]), /press/i);
  });

  it("T3-01 item 4: fails when the launch did not resolve through the leanback category", async () => {
    const judge = await loadJudge();
    expectFailure(judge(["OCTAVE_RESOLVE No activity found", focus(0), press(), focus(1, "10:00:02.300")]), /leanback/i);
  });

  it("T3-01 item 4: fails when the leanback activity belongs to another app", async () => {
    const judge = await loadJudge();
    expectFailure(judge(["OCTAVE_RESOLVE com.example.other/.MainActivity", focus(0), press(), focus(1, "10:00:02.300")]), /leanback/i);
  });

  it("T3-01 item 4: fails when the transcript has no resolve line", async () => {
    const judge = await loadJudge();
    expectFailure(judge([focus(0), press(), focus(1, "10:00:02.300")]), /leanback/i);
  });

  it("T3-01 item 4: does not count a focus line under another tag", async () => {
    const judge = await loadJudge();
    const spoofed = "11-21 10:00:01.000  6000  6000 I ActivityManager: OCTAVE_FOCUS tile-0";
    expectFailure(judge([RESOLVED, spoofed, press(), focus(0, "10:00:02.300")]), /priming|before the press/i);
  });
});

describe("the tv job runs the smoke test on the emulator", () => {
  it("T3-01 item 4: has the root script tv:smoke", () => {
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["tv:smoke"]).toBeTruthy();
  });

  it("T3-01 item 4: runs `pnpm tv:smoke` as the script of the android-emulator-runner step", () => {
    const lines = readFileSync(join(repo, ".github", "workflows", "ci.yml"), "utf8").split("\n");
    const start = lines.findIndex((line) => line === "  tv:");
    expect(start, "ci.yml has a job named tv").toBeGreaterThan(-1);
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^ {2}\S/.test(line));
    const job = end === -1 ? rest : rest.slice(0, end);
    const runner = job.findIndex((line) => line.includes("ReactiveCircus/android-emulator-runner@"));
    expect(runner, "an android-emulator-runner step").toBeGreaterThan(-1);
    const stepStart = job.findLastIndex((line, i) => i <= runner && /^\s+- /.test(line));
    const nextStep = job.findIndex((line, i) => i > runner && /^\s+- /.test(line));
    const step = job.slice(stepStart, nextStep === -1 ? undefined : nextStep);
    expect(step.some((line) => /^\s+script: pnpm tv:smoke\s*$/.test(line))).toBe(true);
    expect(step.join("\n")).toMatch(/target: android-tv/);
  });
});
