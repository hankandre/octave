// @vitest-environment node
// T3-30 (docs/specs/T3-30.md, "The adb module"): redaction runs before the scripts parse adb's output, so a judged value
// that held a form of the serial reads `[device]` to its judge. A judge must fail on such a value, never pass, and the
// floor on derived forms keeps a short host name from rewriting ordinary words.
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = async <T>(name: string) => (await import(pathToFileURL(join(repo, "scripts", name)).href)) as T;

type Adb = { serialForms(serial: string): string[]; redactSerial(text: string, serial: string): string };
type Focus = { judgeFirstFocus(lines: string[]): string[] };
type Clear = { judgeCleartext(report: Record<string, string>, served: unknown[], expected: { publicTotal: number; port: number }): string[] };
type Resolved = { judgeResolvedAddress(report: Record<string, string>, served: unknown[], expected: { port: number }): string[] };

describe("T3-30 judges: a stand-in value fails the judge", () => {
  it("a resolved component that held the serial does not pass", async () => {
    const { judgeFirstFocus } = await load<Focus>("tv-first-focus.mjs");
    const errors = judgeFirstFocus(["OCTAVE_RESOLVE [device]/.MainActivity"]);
    expect(errors.join("\n")).toMatch(/resolves to/);
  });

  it("a focus line whose tile held the serial is no focus", async () => {
    const { judgeFirstFocus } = await load<Focus>("tv-first-focus.mjs");
    const errors = judgeFirstFocus(["11-22 10:00:00.000  1  1 I ReactNativeJS: OCTAVE_FOCUS [device]"]);
    expect(errors.some((line) => /no focus line|no press/.test(line))).toBe(true);
  });

  it("a cleartext report value that held the serial fails each key it stands in for", async () => {
    const { judgeCleartext } = await load<Clear>("tv-cleartext.mjs");
    const report = { policy: "permitted", "target-sdk": "34", "private-lan": "200", loopback: "200", "public-total": "3", "public-refused": "3", "public-other": "0", "https-open": "ok", done: "yes" };
    for (const key of ["policy", "target-sdk", "private-lan", "loopback", "public-total", "public-refused", "public-other", "https-open", "done"]) {
      const errors = judgeCleartext({ ...report, [key]: "[device]" }, [], { publicTotal: 3, port: 1 });
      expect(errors.join("\n"), key).toContain(key === "done" ? "did not finish" : key);
    }
  });

  it("a resolved-address report value that held the serial fails", async () => {
    const { judgeResolvedAddress } = await load<Resolved>("tv-resolved-address.mjs");
    const report = { "resolved-private": "[device]", "resolved-mixed": "200", "resolved-public": "refused-resolved-public", "resolved-asked": "3", "http-outside": "refused-resolved-public", "https-call": "failed-x", "https-asked": "yes", "https-outside": "unjudged", done: "yes" };
    expect(judgeResolvedAddress(report, [], { port: 1 }).join("\n")).toContain("resolved-private=[device]");
  });
});

describe("T3-30 forms: the floor applies to every derived form", () => {
  it("a short bare host is dropped, a six-character one stays", async () => {
    const { serialForms, redactSerial } = await load<Adb>("tv-adb.mjs");
    expect(serialForms("tv:5555")).toEqual(["tv:5555"]);
    expect(serialForms("octave:5555")).toContain("octave");
    expect(redactSerial("octave resolves octave:5555", "octave:5555")).toBe("[device] resolves [device]");
  });

  it("a zone id gives a zone-less form too", async () => {
    const { serialForms } = await load<Adb>("tv-adb.mjs");
    expect(serialForms("[fe80::1%wlan0]:5555")).toContain("fe80::1");
  });
});
