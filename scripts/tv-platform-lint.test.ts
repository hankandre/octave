// @vitest-environment node
// T3-01 spec check note 5: the platform lint also refuses the Android-only names when they are reached without a named
// import (a default or namespace import with member access, or a destructured require), and still accepts them in an
// `.android.tsx` file. ESLint's no-restricted-imports already refuses a namespace import of a module with restricted
// names; the default import and require cases need no-restricted-syntax.
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

const cases: [string, string][] = [
  ["a default import with member access", 'import RN from "react-native";\nexport const toast = RN.ToastAndroid;\n'],
  ["a namespace import with member access", 'import * as RN from "react-native";\nexport const modules = RN.NativeModules;\n'],
  ["require(...).NativeModules", 'export const modules = require("react-native").NativeModules;\n'],
  ["a destructured require", 'const { PermissionsAndroid } = require("react-native");\nexport const ask = PermissionsAndroid;\n'],
  ["expo-modules-core member access", 'import * as core from "expo-modules-core";\nexport const probe = core.requireNativeModule("Probe");\n'],
];

describe("platform lint, member access", () => {
  it.each(cases)("rejects %s in shared TypeScript and names the platform file", (_name, code) => {
    const { status, output } = eslintStdin("apps/tv/src/probe.tsx", code);
    expect(status).not.toBe(0);
    expect(output).toMatch(/no-restricted-(syntax|imports)/);
    expect(output).toMatch(/\.android\.ts/);
  }, TIMEOUT);

  it.each(cases)("accepts %s in an .android.tsx file", (_name, code) => {
    const { status, output } = eslintStdin("apps/tv/src/probe.android.tsx", code);
    expect(output).not.toMatch(/error|warning/);
    expect(status).toBe(0);
  }, TIMEOUT);

  it("rejects a default import's member access through no-restricted-syntax, which the import rule does not see", () => {
    const { output } = eslintStdin("apps/tv/src/probe.tsx", 'import RN from "react-native";\nexport const toast = RN.ToastAndroid;\n');
    expect(output).toMatch(/no-restricted-syntax/);
    expect(output).not.toMatch(/no-restricted-imports/);
  }, TIMEOUT);

  it("accepts portable member access in shared TypeScript", () => {
    const code = 'import { Platform, StyleSheet } from "react-native";\nexport const tv = Platform.isTV;\nexport const styles = StyleSheet.create({});\n';
    const { status, output } = eslintStdin("apps/tv/src/probe.tsx", code);
    expect(output).not.toMatch(/error|warning/);
    expect(status).toBe(0);
  }, TIMEOUT);
});
