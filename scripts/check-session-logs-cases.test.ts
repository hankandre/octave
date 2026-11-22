// @vitest-environment node
// T3-16: edge cases of pnpm lint:logs beyond the frozen samples (scripts/check-session-logs.test.ts).
import { describe, expect, it } from "vitest";
import { findLogViolations } from "./check-session-logs.mjs";

const KT = "modules/session/android/src/main/java/dev/octave/session/http/Case.kt";
const TS = "apps/tv/src/host/case.ts";
const check = (path: string, text: string) => findLogViolations([{ path, text }]);

describe("pnpm lint:logs edge cases", () => {
  it("passes an escaped dollar, a char literal holding a quote and constant concatenation", () => {
    expect(check(KT, 'fun f() {\n  val q = \'"\'\n  Log.i("Octave", "costs \\$5" + " today")\n}\n')).toEqual([]);
  });

  it("fails a Kotlin raw string with a template and a call split over lines, naming the first line", () => {
    const messages = check(KT, 'fun f(url: String) {\n  Log.w(\n    "Octave",\n    """at $url""",\n  )\n}\n');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(`${KT}:2 G2`);
  });

  it("fails a TypeScript single-quoted string joined with a value, and passes a backtick string without a template", () => {
    expect(check(TS, "console.warn('at ' + url);\n")[0]).toContain(`${TS}:1 G2`);
    expect(check(TS, "console.warn(`ready`);\n")).toEqual([]);
  });

  it("fails a logger call and a System.out call, and not a method that only ends in a log word", () => {
    expect(check(KT, "logger.info(request)\n")[0]).toContain("G2");
    expect(check(KT, 'System.out.print(headers)\n')[0]).toContain("G2");
    expect(check(KT, "catalog.println(headers)\nmyLogger.info(x)\n")).toEqual([]);
  });
});
