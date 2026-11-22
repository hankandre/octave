// @vitest-environment node
// T3-20, unfrozen: the probe's resolved-address output, in the shape `am instrument -w` printed it on an Android TV
// emulator (API 36) on 2026-11-22, parses into a report the judge accepts, and a failed run fails closed.
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
    // Recorded with -e hostPort 1: nothing listens, so the two allowed calls fail to connect; the refusal still holds.
    const text = RECORDED.replace("resolved-mixed=200", "resolved-mixed=failed-ConnectException").replace(
      "resolved-private=200",
      "resolved-private=failed-ConnectException",
    );
    const errors = judgeResolvedAddress(parseInstrumentation(text), [], { port: PORT });
    expect(errors.join("\n")).toMatch(/resolved-private=failed-ConnectException/);
    expect(errors.join("\n")).toMatch(/resolved-mixed=failed-ConnectException/);
  });

  it("an aborted run reports no done, and the judge fails it", () => {
    const report = parseInstrumentation(`${RECORDED.replace("INSTRUMENTATION_CODE: -1", "INSTRUMENTATION_CODE: 0")}`);
    expect(report.done).toBeUndefined();
    expect(judgeResolvedAddress(report, served, { port: PORT }).join("\n")).toMatch(/done/);
  });
});
