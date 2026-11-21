// @vitest-environment node
// Cases beside the frozen T3-02 tests (scripts/tv-e2e.test.ts) for what the implementation adds: an empty release
// bundle, and transcripts with a repeated host, url, crypto or clock line.
import { describe, expect, it } from "vitest";
import { judgeBundle } from "./tv-build.mjs";
import { judgeConformance } from "./tv-e2e.mjs";

const EXPECTED = { url: 202, deviceId: 13 };
const GOOD = [
  "OCTAVE_E2E start conformance",
  "OCTAVE_E2E host url=expo-builtin engine=hermes",
  "OCTAVE_E2E url total=202 passed=202",
  "OCTAVE_E2E device-id total=13 passed=13",
  "OCTAVE_E2E crypto random-id=ok",
  "OCTAVE_E2E clock now=ok after=ok every=ok",
  "OCTAVE_E2E done",
];

describe("judgeBundle", () => {
  it("refuses an empty release bundle", () => {
    expect(judgeBundle(new Uint8Array(), "release")).toEqual(["ERROR tv build: the release bundle is empty"]);
  });
});

describe("judgeConformance", () => {
  it.each([
    ["host", /host lines/],
    ["url total", /url lines/],
    ["device-id total", /device-id lines/],
    ["crypto", /crypto/],
    ["clock", /clock/],
  ])("fails a transcript with a repeated %s line", (head, reason) => {
    const lines = GOOD.flatMap((line) => (line.startsWith(`OCTAVE_E2E ${head}`) ? [line, line] : [line]));
    const errors = judgeConformance(lines, EXPECTED);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.join("\n")).toMatch(reason);
  });

  it("fails a url line without counts", () => {
    const lines = GOOD.map((line) => (line.startsWith("OCTAVE_E2E url ") ? "OCTAVE_E2E url total=x" : line));
    expect(judgeConformance(lines, EXPECTED).join("\n")).toMatch(/url line has no total or passed count/);
  });
});
