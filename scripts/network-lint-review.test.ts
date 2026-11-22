// @vitest-environment node
// T3-04 review findings: React Native's and Expo's JavaScript networking reached without the globals the frozen item
// 3 and 7 samples name, through its module paths, `self`, an alias of globalThis or Image, or a native module by name.
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

function expectRefused(path: string, code: string, id: string): void {
  const { status, output } = eslintStdin(path, code);
  expect(status, output).not.toBe(0);
  expect(output).toMatch(/no-restricted-(globals|properties|imports|syntax)/);
  expect(output).toContain(`(T3-04 ${id})`);
}

function expectAccepted(path: string, code: string): void {
  const { status, output } = eslintStdin(path, code);
  expect(output).not.toMatch(/error|warning/);
  expect(status).toBe(0);
}

const PATHS = ["apps/tv/src/probe.tsx", "apps/tv/src/probe.android.tsx", "apps/tv/src/probe.js", "apps/tv/src/host/probe.ts"];

const refused: [string, string, string][] = [
  ["an import of React Native's XMLHttpRequest", 'import XHR from "react-native/Libraries/Network/XMLHttpRequest";\nexport const x = new XHR();\n', "T1"],
  ["an import of RCTNetworking", 'import Networking from "react-native/Libraries/Network/RCTNetworking";\nexport const n = Networking;\n', "T1"],
  ["an import of React Native's WebSocket", 'import WS from "react-native/Libraries/WebSocket/WebSocket";\nexport const w = WS;\n', "T1"],
  ["a require of React Native's fetch", 'export const f = require("react-native/Libraries/Network/fetch");\n', "T1"],
  ["an import() of RCTNetworking", 'export const n = import("react-native/Libraries/Network/RCTNetworking");\n', "T1"],
  ["an import of the Networking spec", 'import N from "react-native/src/private/specs_DEPRECATED/modules/NativeNetworkingAndroid";\nexport const n = N;\n', "T1"],
  ["self.fetch", 'export const load = self.fetch("/x");\n', "T1"],
  ["an alias of globalThis", 'const g = globalThis;\nexport const load = g.fetch("/x");\n', "T1"],
  ["an alias of globalThis, XMLHttpRequest", "const g = globalThis;\nexport const x = new g.XMLHttpRequest();\n", "T1"],
  ["NativeModules.Networking", 'import { NativeModules } from "react-native";\nexport const s = NativeModules.Networking.sendRequest;\n', "T1"],
  ["NativeModules['WebSocketModule']", 'import { NativeModules } from "react-native";\nexport const s = NativeModules["WebSocketModule"];\n', "T1"],
  ["a destructured Networking", 'import { NativeModules } from "react-native";\nconst { Networking } = NativeModules;\nexport const n = Networking;\n', "T1"],
  ["TurboModuleRegistry.getEnforcing('Networking')", 'import { TurboModuleRegistry } from "react-native";\nexport const n = TurboModuleRegistry.getEnforcing("Networking");\n', "T1"],
  ["requireNativeModule('ExpoFetchModule')", 'import { requireNativeModule } from "expo-modules-core";\nexport const f = requireNativeModule("ExpoFetchModule");\n', "T1"],
  ["an aliased Image's prefetch", 'import { Image as Pic } from "react-native";\nexport const warm = Pic.prefetch("http://192.0.2.1/a.jpg");\n', "T3"],
  ["Image.prefetchWithMetadata", 'import { Image } from "react-native";\nexport const warm = Image.prefetchWithMetadata("http://192.0.2.1/a.jpg", "q");\n', "T3"],
  ["an import of React Native's image loader", 'import Loader from "react-native/Libraries/Image/NativeImageLoaderAndroid";\nexport const l = Loader;\n', "T3"],
  ["a require of React Native's image loader", 'export const l = require("react-native/Libraries/Image/ImageLoader");\n', "T3"],
  ["NativeModules.ImageLoader", 'import { NativeModules } from "react-native";\nexport const l = NativeModules.ImageLoader;\n', "T3"],
  ["requireNativeModule('FileSystem')", 'import { requireNativeModule } from "expo-modules-core";\nexport const f = requireNativeModule("FileSystem");\n', "T4"],
  ["requireOptionalNativeModule('ExpoAsset')", 'import { requireOptionalNativeModule } from "expo-modules-core";\nexport const a = requireOptionalNativeModule("ExpoAsset");\n', "T4"],
];

describe("T3-04 review: React Native's and Expo's networking below the globals", () => {
  for (const path of PATHS) {
    it.each(refused)(`refuses %s in ${path}`, (_name, code, id) => expectRefused(path, code, id), TIMEOUT);
  }

  it.each([
    ["another React Native library path", 'import { Platform } from "react-native";\nexport const os = Platform.OS;\n'],
    ["globalThis.URL", "export const ok = typeof globalThis.URL;\n"],
    ["a native module that sends nothing", 'import { requireNativeModule } from "expo-modules-core";\nexport const c = requireNativeModule("ExpoCrypto");\n'],
  ])("accepts %s in an Android file", (_name, code) => expectAccepted("apps/tv/src/probe.android.tsx", code), TIMEOUT);
});
