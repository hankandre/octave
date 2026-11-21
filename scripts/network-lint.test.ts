// @vitest-environment node
// T3-04 items 3 and 4: ESLint (`pnpm lint`) refuses, in every file under apps/tv, JavaScript that sends from the app,
// passes a header or token, gives React Native's Image a network source, imports an Expo HTTP path, or uses "use dom";
// and refuses WebSocket and EventSource in the core outside its adapters. Each message names the allowed alternative.
//
// The alternatives are the spec's ("TypeScript and JavaScript rules" table), held here and compared without backticks;
// eslint.config.js need not export them. Each rule runs on a shared, an `.android` file, a `src/host/` file and a
// JavaScript file, because flat config replaces a rule's options per file.
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

const ALTERNATIVE: Record<string, string> = {
  T1: "The app sends nothing from JavaScript (decision 0005). Call the gateway in `@octave/core`; it sends through the Transport port and the native session module.",
  T2: "JavaScript holds no token and sends no header (decision 0005). Pass the session id; native code adds the header.",
  T3: 'React Native\'s `Image` shows bundled assets only: `source={require("./file.png")}`. Server artwork goes through the native image view (T3-11); video through the PlayerEngine launch request.',
  T4: "This package opens its own HTTP path, which cannot send the header. Use the gateway in `@octave/core` for data and the native image view (T3-11) for artwork.",
  T5: "A WebView cannot send the header (invariant I7). Build the screen from the shared native controls.",
  T6: "Reach the server through the injected Transport (packages/core/src/ports/transport.ts).",
};

const RULE_NAME = /no-restricted-(globals|properties|imports|syntax)/;

// The four kinds of apps/tv path. A sample with JSX uses `.tsx` in src/host/, since `.ts` does not parse JSX.
const pathsFor = (jsx: boolean) => ["apps/tv/src/probe.tsx", "apps/tv/src/probe.android.tsx", jsx ? "apps/tv/src/host/probe.tsx" : "apps/tv/src/host/probe.ts", "apps/tv/probe.js"];

function expectRefused(path: string, code: string, rule: string): void {
  const { status, output } = eslintStdin(path, code);
  expect(status, output).not.toBe(0);
  expect(output).toMatch(RULE_NAME);
  expect(plain(output), output).toContain(plain(ALTERNATIVE[rule]));
}

function expectAccepted(path: string, code: string): void {
  const { status, output } = eslintStdin(path, code);
  expect(output).not.toMatch(/error|warning/);
  expect(status).toBe(0);
}

type Case = [name: string, code: string, jsx: boolean];

const T1: Case[] = [
  ["fetch with headers", 'export const load = (url) => fetch(url, { headers });\n', false],
  ["new XMLHttpRequest()", "export const request = new XMLHttpRequest();\n", false],
  ["globalThis.fetch", 'export const load = globalThis.fetch("/x");\n', false],
  ["new WebSocket", 'export const socket = new WebSocket("ws://192.0.2.1/socket");\n', false],
  ["new EventSource", 'export const events = new EventSource("/events");\n', false],
  ["window.fetch", 'export const load = window.fetch("/x");\n', false],
  ["global.WebSocket", "export const Socket = global.WebSocket;\n", false],
];

const T2: Case[] = [
  ["a headers key", "export const init = { headers: {} };\n", false],
  ["a token prop", "const Thing = () => null;\nexport const view = <Thing token={x} />;\n", true],
  ["an Authorization key", "export const init = { Authorization: value };\n", false],
  ["an X-Emby-Token key", 'export const init = { "X-Emby-Token": value };\n', false],
  ["an accessToken key", "export const init = { accessToken: value };\n", false],
  ["an api_key key", "export const query = { api_key: value };\n", false],
  ["a MediaBrowser Token= template", 'export const header = `MediaBrowser Client="Octave", Token=${value}`;\n', false],
];

const T3: Case[] = [
  ["Image with a uri source", 'import { Image } from "react-native";\nexport const art = <Image source={{ uri: "http://192.0.2.1/a.jpg" }} />;\n', true],
  ["Image with a variable source", 'import { Image } from "react-native";\nexport const art = <Image source={logo} />;\n', true],
  ["Image.prefetch", 'import { Image } from "react-native";\nexport const warm = Image.prefetch("http://192.0.2.1/a.jpg");\n', false],
  ["Image.getSize", 'import { Image } from "react-native";\nexport const size = Image.getSize("http://192.0.2.1/a.jpg", () => {});\n', false],
  ["a uri key", 'export const source = { uri: "http://192.0.2.1/a.jpg" };\n', false],
];

const FETCH_TRANSPORT: Case[] = [
  ["an import of the core's fetch transport", 'import { createFetchTransport } from "@octave/core/src/adapters/fetch-transport";\nexport const transport = createFetchTransport;\n', false],
  ["a require of the core's fetch transport", 'export const transport = require("@octave/core/src/adapters/fetch-transport");\n', false],
  ["an import() of the fetch transport by relative path", 'export const transport = import("../../../packages/core/src/adapters/fetch-transport");\n', false],
];

describe("T3-04 item 3: no header, token or Authorization value on an image, video or fetch call in apps/tv", () => {
  for (const [rule, cases] of [["T1", T1], ["T2", T2], ["T3", T3]] as const) {
    for (const [name, code, jsx] of cases) {
      it.each(pathsFor(jsx))(`T3-04 item 3: ${rule} refuses ${name} in %s`, (path) => expectRefused(path, code, rule), TIMEOUT);
    }
  }

  // Spec check issue 2: the core's fetch transport is exempt from the fetch rule, so importing it would send from
  // JavaScript over React Native's client with a header built in JavaScript.
  for (const [name, code, jsx] of FETCH_TRANSPORT) {
    it.each(pathsFor(jsx))(
      `T3-04 item 3: refuses ${name} in %s`,
      (path) => {
        const { status, output } = eslintStdin(path, code);
        expect(status, output).not.toBe(0);
        expect(output).toMatch(/no-restricted-(imports|syntax)/);
        expect(plain(output)).toMatch(/gateway in @octave\/core/);
      },
      TIMEOUT,
    );
  }

  it.each(pathsFor(false))(
    "T3-04 item 3: accepts a port import from the core in %s",
    (path) => expectAccepted(path, 'import * as transportPort from "@octave/core/src/ports/transport";\nexport const port = transportPort;\n'),
    TIMEOUT,
  );

  it.each(pathsFor(false))(
    "T3-04 item 3: accepts an image request by session, item, type, tag and width in %s",
    (path) => expectAccepted(path, 'export const art = { session: "s", itemId: "i", imageType: "Primary", tag: "t", width: 300 };\n'),
    TIMEOUT,
  );

  it.each(pathsFor(false))(
    "T3-04 item 3: accepts design tokens and headerShown in %s",
    (path) => expectAccepted(path, "const tokens = { color: { text: 1 } };\nexport const text = tokens.color.text;\nexport const options = { headerShown: false };\n"),
    TIMEOUT,
  );

  it.each(pathsFor(true))(
    "T3-04 item 3: accepts a bundled Image source in %s",
    (path) => expectAccepted(path, 'import { Image } from "react-native";\nexport const logo = <Image source={require("./logo.png")} />;\n'),
    TIMEOUT,
  );

  it.each([
    ["new WebSocket", 'export const socket = new WebSocket("ws://192.0.2.1/socket");\n'],
    ["new EventSource", 'export const events = new EventSource("/events");\n'],
  ])(
    "T3-04 item 3: T6 refuses %s in the core outside its adapters",
    (_name, code) => expectRefused("packages/core/src/jellyfin/probe.ts", code, "T6"),
    TIMEOUT,
  );

  it(
    "T3-04 item 3: T6 accepts new WebSocket in a core adapter",
    () => expectAccepted("packages/core/src/adapters/probe.ts", 'export const socket = new WebSocket("ws://192.0.2.1/socket");\n'),
    TIMEOUT,
  );
});

// Item 4: one failing and one passing sample per T rule; the failing output holds the rule's alternative.
const TABLE: Record<string, { fail: [string, string]; pass: [string, string] }> = {
  T1: { fail: ["apps/tv/src/probe.tsx", 'export const load = fetch("/x");\n'], pass: ["apps/tv/src/probe.tsx", 'import type { Transport } from "@octave/core/src/ports/transport";\nexport type T = Transport;\n'] },
  T2: { fail: ["apps/tv/src/probe.tsx", "export const init = { headers: {} };\n"], pass: ["apps/tv/src/probe.tsx", 'export const art = { session: "s", itemId: "i", imageType: "Primary", tag: "t", width: 300 };\n'] },
  T3: {
    fail: ["apps/tv/src/probe.tsx", 'import { Image } from "react-native";\nexport const art = <Image source={{ uri: "http://192.0.2.1/a.jpg" }} />;\n'],
    pass: ["apps/tv/src/probe.tsx", 'import { Image } from "react-native";\nexport const logo = <Image source={require("./logo.png")} />;\n'],
  },
  T4: { fail: ["apps/tv/src/probe.tsx", 'import { fetch } from "expo/fetch";\nexport const load = fetch;\n'], pass: ["apps/tv/src/host/probe.ts", 'import { randomUUID } from "expo-crypto";\nexport const id = randomUUID;\n'] },
  T5: { fail: ["apps/tv/src/probe.tsx", '"use dom";\nexport default function Page() {\n  return null;\n}\n'], pass: ["apps/tv/src/probe.tsx", "export default function Page() {\n  return null;\n}\n"] },
  T6: { fail: ["packages/core/src/jellyfin/probe.ts", 'export const socket = new WebSocket("ws://192.0.2.1/socket");\n'], pass: ["packages/core/src/jellyfin/probe.ts", "export const ok = 1;\n"] },
};

describe("T3-04 item 4: every TypeScript rule has a failing and a passing sample, and names its alternative", () => {
  it.each(Object.keys(TABLE))(
    "T3-04 item 4: %s refuses its failing sample with its alternative",
    (rule) => {
      const [path, code] = TABLE[rule].fail;
      expectRefused(path, code, rule);
    },
    TIMEOUT,
  );

  it.each(Object.keys(TABLE))(
    "T3-04 item 4: %s accepts its passing sample",
    (rule) => {
      const [path, code] = TABLE[rule].pass;
      expectAccepted(path, code);
    },
    TIMEOUT,
  );
});
