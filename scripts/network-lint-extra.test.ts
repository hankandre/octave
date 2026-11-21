// @vitest-environment node
// T3-04, beyond the frozen samples in scripts/network-lint.test.ts: T7 (the core's fetch transport, spec check issue
// 2) with its own message, the network rules on a module's JavaScript (issue 7), and a few more shapes of T2 to T4.
// Not frozen.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT = 60_000;
const ESLINT = ["--import", "./scripts/typescript-6-resolve.mjs", "node_modules/eslint/bin/eslint.js", "--max-warnings", "0"];

function eslintStdin(path: string, code: string): { status: number | null; output: string } {
  const child = spawnSync(process.execPath, [...ESLINT, "--stdin", "--stdin-filename", path], { cwd: repo, input: code, encoding: "utf8" });
  return { status: child.status, output: `${child.stdout ?? ""}\n${child.stderr ?? ""}` };
}

const plain = (text: string) => text.replace(/`/g, "").replace(/\s+/g, " ").trim();

const T7 =
  "The core's fetch transport sends from JavaScript over React Native's client, with a header built in JavaScript (decision 0005). Call the gateway in `@octave/core`; the app's transport is the native session module.";

function expectRefused(path: string, code: string, text: RegExp | string): void {
  const { status, output } = eslintStdin(path, code);
  expect(status, output).not.toBe(0);
  expect(output).toMatch(/no-restricted-(globals|properties|imports|syntax)/);
  if (typeof text === "string") expect(plain(output), output).toContain(plain(text));
  else expect(output).toMatch(text);
}

function expectAccepted(path: string, code: string): void {
  const { status, output } = eslintStdin(path, code);
  expect(output).not.toMatch(/error|warning/);
  expect(status).toBe(0);
}

describe("T3-04 T7: the core's fetch transport is not the app's", () => {
  it.each([
    ["an import", 'import { createFetchTransport } from "@octave/core/src/adapters/fetch-transport";\nexport const t = createFetchTransport;\n'],
    ["an import with an extension", 'import { createFetchTransport } from "../../packages/core/src/adapters/fetch-transport.ts";\nexport const t = createFetchTransport;\n'],
    ["a require", 'export const t = require("@octave/core/src/adapters/fetch-transport");\n'],
    ["an import()", 'export const t = import("@octave/core/src/adapters/fetch-transport");\n'],
    ["a re-export", 'export * from "@octave/core/src/adapters/fetch-transport";\n'],
  ])("refuses %s with T7's message", (_name, code) => expectRefused("apps/tv/src/probe.tsx", code, T7), TIMEOUT);

  it("accepts another core adapter", () => expectAccepted("apps/tv/src/probe.tsx", 'import * as clock from "@octave/core/src/ports/clock";\nexport const c = clock;\n'), TIMEOUT);
});

describe("T3-04: the network rules cover a module's JavaScript once modules/ is linted", () => {
  it.each(["modules/session/src/probe.ts", "modules/session/src/probe.tsx", "modules/session/index.ts", "modules/session/src/probe.js"])(
    "refuses fetch and a headers key in %s",
    (path) => {
      expectRefused(path, 'export const load = fetch("/x");\n', /The app sends nothing from JavaScript/);
      expectRefused(path, "export const init = { headers: {} };\n", /JavaScript holds no token/);
    },
    TIMEOUT,
  );

  it("accepts a session id in a module file", () => expectAccepted("modules/session/src/probe.ts", 'export const call = { session: "s", path: "/Items" };\n'), TIMEOUT);
});

describe("T3-04: more shapes of T2 to T4", () => {
  it.each([
    ["a class field named token", "export class Session {\n  token = 1;\n}\n", /JavaScript holds no token/],
    ["a destructured token", "export const read = ({ token }) => token;\n", /JavaScript holds no token/],
    ["an upper-case Authorization attribute", "const Thing = () => null;\nexport const v = <Thing Authorization={x} />;\n", /JavaScript holds no token/],
    ["a string src", 'export const v = <img src="http://192.0.2.1/a.jpg" />;\n', /shows bundled assets only/],
    ["RN.Image.prefetch", 'import * as RN from "react-native";\nexport const warm = RN.Image.prefetch("http://192.0.2.1/a.jpg");\n', /shows bundled assets only/],
    ["expo-image", 'import { Image } from "expo-image";\nexport const I = Image;\n', /opens its own HTTP path/],
    ["a require of expo-image", 'export const I = require("expo-image");\n', /opens its own HTTP path/],
    ["a re-export of expo/fetch", 'export { fetch } from "expo/fetch";\n', /opens its own HTTP path/],
  ])("refuses %s", (_name, code, text) => expectRefused("apps/tv/src/probe.tsx", code, text), TIMEOUT);

  it.each([
    ["a design token", "const tokens = { space: 4 };\nexport const s = tokens.space;\n"],
    ["a navigation option", "export const options = { headerShown: false, headerTitle: 'x' };\n"],
    ["a sessionToken-like name", "export const view = { sessionId: 's', tokenCount: 2 };\n"],
  ])("accepts %s", (_name, code) => expectAccepted("apps/tv/src/probe.tsx", code), TIMEOUT);
});
