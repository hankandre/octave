// @vitest-environment node
// T3-03: modules/session is a workspace package the TV app depends on, an Expo module whose config names a class that
// exists, with the JUnit BOM of the app's JVM tests and the pinned versions of docs/specs/T3-03.md, "Dependencies".
// T3-05 changes three expectations (docs/specs/T3-05.md, "Files to touch"): the package's main is its JavaScript
// surface, src/index.ts; kotlinx-serialization-json ships in the APK (an implementation line at the same pin); and
// pnpm lint reads modules, so ESLint's network rules see the surface (a zero-file run cannot pass as green).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const moduleDir = join(root, "modules", "session");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const require = createRequire(import.meta.url);
const plugin = require("../apps/tv/plugins/with-app-jvm-tests.js") as { JUNIT_BOM: string };

describe("the session module", () => {
  it("is a workspace package the TV app depends on", () => {
    expect(read("pnpm-workspace.yaml")).toMatch(/^\s*-\s+modules\/\*\s*$/m);
    const manifest = JSON.parse(read("modules/session/package.json")) as { name: string; private: boolean; license: string; main?: string };
    expect(manifest).toMatchObject({ name: "@octave/session", private: true, license: "GPL-3.0-only" });
    expect(manifest.main).toBe("src/index.ts");
    expect(existsSync(join(moduleDir, "src", "index.ts"))).toBe(true);
    const app = JSON.parse(read("apps/tv/package.json")) as { dependencies: Record<string, string> };
    expect(app.dependencies["@octave/session"]).toBe("workspace:*");
  });

  it("names an Android module class that exists, and only Android", () => {
    const config = JSON.parse(read("modules/session/expo-module.config.json")) as { platforms: string[]; android: { modules: string[] } };
    expect(config.platforms).toEqual(["android"]);
    expect(config.android.modules).toEqual(["dev.octave.session.OctaveSessionModule"]);
    const path = join(moduleDir, "android", "src", "main", "java", ...config.android.modules[0].split(".")) + ".kt";
    expect(existsSync(path)).toBe(true);
  });

  it("pins its dependencies and uses the app's JUnit BOM", () => {
    const gradle = read("modules/session/android/build.gradle");
    expect(gradle).toContain("def okhttpVersion = '5.5.1'");
    expect(gradle).toContain("def kotlinxSerializationJsonVersion = '1.9.0'");
    expect(gradle).toContain('implementation "com.squareup.okhttp3:okhttp:${okhttpVersion}"');
    expect(gradle).toContain('testImplementation "com.squareup.okhttp3:mockwebserver3:${okhttpVersion}"');
    expect(gradle).toMatch(/^\s*implementation "org\.jetbrains\.kotlinx:kotlinx-serialization-json:\$\{kotlinxSerializationJsonVersion\}"\s*$/m);
    expect(gradle).not.toMatch(/testImplementation "org\.jetbrains\.kotlinx:kotlinx-serialization-json/);
    expect(gradle).toContain(`def junitBom = '${plugin.JUNIT_BOM}'`);
    expect(gradle).not.toMatch(/junit:junit:4|robolectric|logging-interceptor/);
  });

  it("is read by pnpm lint, whose network rules refuse a fetch in its surface", () => {
    const lint = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts.lint;
    const paths = lint.split(/\s+/).slice(lint.split(/\s+/).indexOf("0") + 1);
    expect(paths.some((path) => /^(?:\.\/)?modules(?:\/|$)/.test(path))).toBe(true);
    const eslint = ["--import", "./scripts/typescript-6-resolve.mjs", "node_modules/eslint/bin/eslint.js", "--max-warnings", "0"];
    const child = spawnSync(process.execPath, [...eslint, "--stdin", "--stdin-filename", "modules/session/src/index.ts"], {
      cwd: root,
      input: 'export const probe = () => fetch("http://127.0.0.1:8096/System/Info/Public");\n',
      encoding: "utf8",
    });
    expect(child.status).toBe(1);
    expect(`${child.stdout}${child.stderr}`).toMatch(/T1/);
  }, 60_000);
});
