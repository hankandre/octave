// @vitest-environment node
// T3-16 review follow-up (docs/plans/active/009-t3-16-review-followups.md): forms of a log call that the first
// pnpm lint:logs missed, so docs/security.md's "Tested" row for the log check holds for them too. Each case was
// 0 violations before the fix; the controls show the stricter reading does not fail plain code.
import { describe, expect, it } from "vitest";
import { findLogViolations } from "./check-session-logs.mjs";

const KT = "modules/session/android/src/main/java/dev/octave/session/http/Bypass.kt";
const TS = "apps/tv/src/host/bypass.ts";
const TSX = "apps/tv/src/host/bypass.tsx";
const check = (path: string, text: string) => findLogViolations([{ path, text }]);

// Fails on G2 at the given line.
function expectG2(path: string, text: string, line: number) {
  const messages = check(path, text);
  expect(messages.length, `${JSON.stringify(text)} fails`).toBeGreaterThan(0);
  expect(messages.some((message) => message.includes(`${path}:${line} G2`)), messages.join(" | ")).toBe(true);
}

describe("pnpm lint:logs: console forms in TypeScript", () => {
  it("fails optional, qualified and computed console calls that take a value", () => {
    expectG2(TS, "console?.log(url);\n", 1);
    expectG2(TS, "console?.warn(request.path, url);\n", 1);
    expectG2(TS, "console.log?.(url);\n", 1);
    expectG2(TS, "globalThis.console.log(url);\n", 1);
    expectG2(TS, "window.console.error(url);\n", 1);
    expectG2(TS, "console['log'](url);\n", 1);
    expectG2(TS, 'console["log"](url);\n', 1);
  });

  it("fails any console use that is not a direct call: an alias, a destructuring, a computed name, call and bind", () => {
    expectG2(TS, "const { warn } = console;\nwarn(url);\n", 1);
    expectG2(TS, "const c = console;\nc.log(url);\n", 1);
    expectG2(TS, "console[method](url);\n", 1);
    expectG2(TS, "console.log.call(console, url);\n", 1);
    expectG2(TS, "const log = console.log.bind(console);\n", 1);
  });

  it("reads past a regex literal that holds a quote, so a log call after it is still seen", () => {
    expectG2(TS, 'const r = /"/; console.log(url); // "\n', 1);
    expectG2(TS, "const r = /'/g;\nconsole.log(url); // '\n", 2);
    expectG2(TS, 'const r = /[/"]/;\nconsole.info(url);\n', 2);
    expectG2(TS, 'if (/a\\/"/.test(x)) console.debug(url);\n', 1);
  });

  it("reads the code inside a template's ${...}", () => {
    expectG2(TS, "const s = `at ${console.log(url)}`;\n", 1);
    expectG2(TS, "const s = `a\nb ${console.log(url)}`;\n", 2);
  });

  it("controls: a constant console call, division and a TSX closing tag still pass", () => {
    expect(check(TS, 'console.info("ready");\nconsole?.warn("slow");\nconsole["log"]("ok");\n')).toEqual([]);
    expect(check(TS, 'const half = total / 2 / count;\nconsole.info("ready");\n')).toEqual([]);
    expect(check(TS, 'const r = /"/;\nconsole.info("ready");\n')).toEqual([]);
    expect(check(TSX, 'const v = <Text>a</Text>;\nconsole.info("ready");\n')).toEqual([]);
    expect(check(TS, "const catalogLog: string[] = [];\nconst consoleLike = 1;\n")).toEqual([]);
  });
});

describe("pnpm lint:logs: Kotlin forms", () => {
  it("fails a Timber chain whose later call takes a value", () => {
    expectG2(KT, 'fun f(url: String) {\n  Timber.tag("x").d(url)\n}\n', 2);
    expectG2(KT, "fun f(url: String) {\n  Timber.Forest.d(url)\n}\n", 2);
    expectG2(KT, "fun f(url: String) {\n  val t = Timber\n}\n", 2);
  });

  it("fails kotlin.io.println and a log call inside a ${...} template", () => {
    expectG2(KT, "fun f(url: String) {\n  kotlin.io.println(url)\n}\n", 2);
    expectG2(KT, 'fun f(url: String) {\n  val s = "${println(url)}"\n}\n', 2);
  });

  it("controls: a Timber import, a constant Timber chain and a constant println pass", () => {
    const text = 'import timber.log.Timber\n\nfun f() {\n  Timber.tag("x").d("ready")\n  kotlin.io.println("ready")\n}\n';
    expect(check(KT, text)).toEqual([]);
  });
});
