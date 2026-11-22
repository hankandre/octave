// @vitest-environment node
// T3-20, unfrozen: the probe's resolved-address output parses into a report the judge accepts, and a failed run fails
// closed. The passing lines are rebuilt from release-evidence/tv/e2e-resolved-address.txt of a passing pnpm tv:e2e run
// (fluster_tv, android-36, 2026-11-22) in the format `am instrument -w` printed; NO_SERVER is that command's output
// verbatim for a run with -e hostPort 1, where nothing listens.
import { describe, expect, it } from "vitest";
import { parseInstrumentation } from "./tv-cleartext.mjs";
import { RESOLVED_REPORT_KEYS, judgeResolvedAddress } from "./tv-resolved-address.mjs";

const PORT = 40123;

// The report lines of a passing run; Android prints them sorted by key.
const RECORDED = [
  "INSTRUMENTATION_RESULT: done=yes",
  "INSTRUMENTATION_RESULT: http-outside=refused-resolved-public",
  "INSTRUMENTATION_RESULT: https-asked=yes",
  "INSTRUMENTATION_RESULT: https-call=failed-SSLException",
  "INSTRUMENTATION_RESULT: https-outside=unjudged",
  "INSTRUMENTATION_RESULT: resolved-asked=3",
  "INSTRUMENTATION_RESULT: resolved-mixed=200",
  "INSTRUMENTATION_RESULT: resolved-private=200",
  "INSTRUMENTATION_RESULT: resolved-public=refused-resolved-public",
  "INSTRUMENTATION_CODE: -1",
].join("\r\n");

// Captured verbatim: the two allowed calls and the HTTPS call fail to connect; the refusal and the re-entries hold.
const NO_SERVER = [
  "INSTRUMENTATION_RESULT: done=yes",
  "INSTRUMENTATION_RESULT: http-outside=refused-resolved-public",
  "INSTRUMENTATION_RESULT: https-asked=yes",
  "INSTRUMENTATION_RESULT: https-call=failed-ConnectException",
  "INSTRUMENTATION_RESULT: https-outside=unjudged",
  "INSTRUMENTATION_RESULT: resolved-asked=3",
  "INSTRUMENTATION_RESULT: resolved-mixed=failed-ConnectException",
  "INSTRUMENTATION_RESULT: resolved-private=failed-ConnectException",
  "INSTRUMENTATION_RESULT: resolved-public=refused-resolved-public",
  "INSTRUMENTATION_CODE: -1",
].join("\n");

const served = [
  { path: "/octave-probe/resolved-private", host: `octave-probe-private.home.arpa:${PORT}`, header: true },
  { path: "/octave-probe/resolved-mixed", host: `octave-probe-mixed.home.arpa:${PORT}`, header: true },
];

describe("the resolved-address check's recorded output", () => {
  it("parses into a report with every key, which the judge accepts", () => {
    const report = parseInstrumentation(RECORDED);
    expect(Object.keys(report).sort()).toEqual([...RESOLVED_REPORT_KEYS].sort());
    expect(judgeResolvedAddress(report, served, { port: PORT })).toEqual([]);
  });

  it("a run with no server behind 10.0.2.2 fails on both expected cases", () => {
    const errors = judgeResolvedAddress(parseInstrumentation(NO_SERVER), [], { port: PORT });
    expect(errors.join("\n")).toMatch(/resolved-private=failed-ConnectException/);
    expect(errors.join("\n")).toMatch(/resolved-mixed=failed-ConnectException/);
  });

  it("an aborted run reports no done, and the judge fails it", () => {
    const report = parseInstrumentation(`${RECORDED.replace("INSTRUMENTATION_CODE: -1", "INSTRUMENTATION_CODE: 0")}`);
    expect(report.done).toBeUndefined();
    expect(judgeResolvedAddress(report, served, { port: PORT }).join("\n")).toMatch(/done/);
  });
});
