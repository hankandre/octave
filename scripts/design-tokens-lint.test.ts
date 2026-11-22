// @vitest-environment node
// T3-06 item 2: ESLint (`pnpm lint`) fails on a hard-coded colour, size, radius or duration in app code outside the
// tokens file. The rule is `octave/design-tokens` (scripts/eslint-design-tokens.mjs), on apps/tv/src/**/*.{ts,tsx}
// except apps/tv/src/design/tokens.ts, test files, src/host/ and src/e2e/. Each sample goes through ESLint on stdin, as
// scripts/network-lint.test.ts does. The T3-04 network rules on the same files must stay in force.
//
// `px(0)` is left out on purpose: the spec reads both "any literal argument to px(...)" and "0 is allowed".
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT = 60_000;
const ESLINT = ["--import", "./scripts/typescript-6-resolve.mjs", "node_modules/eslint/bin/eslint.js", "--max-warnings", "0"];
const APP = "apps/tv/src/probe.tsx";

function eslintStdin(path: string, code: string): { status: number | null; output: string } {
  const child = spawnSync(process.execPath, [...ESLINT, "--stdin", "--stdin-filename", path], { cwd: repo, input: code, encoding: "utf8" });
  return { status: child.status, output: `${child.stdout ?? ""}\n${child.stderr ?? ""}` };
}

function expectRefused(code: string, path = APP): void {
  const { status, output } = eslintStdin(path, code);
  expect(status, output).toBe(1);
  expect(output).toContain("octave/design-tokens");
}

function expectAccepted(code: string, path = APP): void {
  const { status, output } = eslintStdin(path, code);
  expect(output).not.toMatch(/error|warning/);
  expect(status).toBe(0);
}

const REFUSED: [name: string, code: string][] = [
  ["a hex colour", 'export const style = { backgroundColor: "#0b0c0e" };\n'],
  ["a hex colour in a plain string", 'export const label = "#abc123";\n'],
  ["an rgb() colour", 'export const style = { borderColor: "rgb(242 239 233 / .10)" };\n'],
  ['"transparent" as a borderColor', 'export const style = { borderColor: "transparent" };\n'],
  ['a JSX color="..."', 'const Thing = () => null;\nexport const view = <Thing color="red" />;\n'],
  ["width: 248", "export const style = { width: 248 };\n"],
  ["padding: px(24)", "declare const px: (n: number) => number;\nexport const style = { padding: px(24) };\n"],
  ["fontSize: 28", "export const style = { fontSize: 28 };\n"],
  ["borderRadius: 10", "export const style = { borderRadius: 10 };\n"],
  ["space5 + 4 in a size key", "declare const space5: number;\nexport const style = { padding: space5 + 4 };\n"],
  ["duration: 240", "export const timing = { duration: 240 };\n"],
  ["setTimeout(fn, 5000)", "declare const fn: () => void;\nexport const timer = setTimeout(fn, 5000);\n"],
  ["transform: [{ scale: 1.08 }]", "export const style = { transform: [{ scale: 1.08 }] };\n"],
  ["an expo-font import", 'import * as Font from "expo-font";\nexport const fonts = Font;\n'],
  ["an expo-font require", 'export const fonts = require("expo-font");\n'],
];

describe("T3-06 item 2: the design-token lint refuses hard-coded values in app code", () => {
  for (const [name, code] of REFUSED) {
    it(`refuses ${name}`, () => {
      expectRefused(code);
    }, TIMEOUT);
  }
});

describe("T3-06 item 2: the design-token lint accepts token use and the allowed literals", () => {
  it("accepts the same styles written with tokens", () => {
    expectAccepted(
      [
        "declare const colors: { surface1: string; focus: string };",
        "declare const space5: number;",
        "declare const radii: { radiusControl: number };",
        "declare const motion: { durQuick: number; lift: number };",
        "declare const px: (n: number) => number;",
        "export const style = { backgroundColor: colors.surface1, borderColor: colors.focus, padding: space5, borderRadius: radii.radiusControl, width: px(space5) };",
        "export const timing = { duration: motion.durQuick, toValue: motion.lift };",
        "",
      ].join("\n"),
    );
  }, TIMEOUT);

  it("accepts 0, flex: 1, percentage strings, aspectRatio and a token times a literal", () => {
    expectAccepted(
      [
        "declare const posterW: number;",
        'export const style = { width: 0, flex: 1, height: "50%", aspectRatio: 2 / 3, minHeight: posterW * 1.5, transform: [{ scale: 1 }] };',
        "",
      ].join("\n"),
    );
  }, TIMEOUT);

  it("accepts hard-coded values in the tokens file", () => {
    expectAccepted('export const colors = { void: "#060708" };\nexport const sizes = { posterW: 248 };\nexport const motion = { durQuick: 160 };\n', "apps/tv/src/design/tokens.ts");
  }, TIMEOUT);

  it("leaves test files, src/host and src/e2e out of the rule", () => {
    const code = "export const style = { width: 248, borderColor: \"#fff\" };\n";
    expectAccepted(code, "apps/tv/src/probe.test.tsx");
    expectAccepted(code, "apps/tv/src/host/probe.ts");
    expectAccepted(code, "apps/tv/src/e2e/probe.ts");
  }, TIMEOUT);

  it("does not apply outside apps/tv/src", () => {
    expectAccepted("export const style = { width: 248 };\n", "packages/core/src/probe.ts");
  }, TIMEOUT);
});

describe("T3-06 item 2: the T3-04 network rules still hold on the same path", () => {
  it("still refuses fetch(url) with its T1 message", () => {
    const { status, output } = eslintStdin(APP, "export const load = (url: string) => fetch(url);\n");
    expect(status, output).toBe(1);
    expect(output).toMatch(/no-restricted-(globals|properties|imports|syntax)/);
    expect(output.replace(/`/g, "").replace(/\s+/g, " ")).toContain("The app sends nothing from JavaScript (decision 0005)");
  }, TIMEOUT);
});
