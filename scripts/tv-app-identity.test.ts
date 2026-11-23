// @vitest-environment node
// T3-21 item 7 (docs/specs/T3-21.md, "Approach: The application ID"): the application ID is the core's constant, and
// the Kotlin package stays dev.octave.tv. apps/tv/app.config.ts passes the ID to the signing plugin as an option, and
// the plugin's Gradle text sets applicationId from it while the namespace stays the Kotlin package.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ANDROID_APPLICATION_ID } from "../packages/core/src/domain/app-identity";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const TEMPLATE = readFileSync(join(repo, "scripts", "fixtures", "tv", "signing", "template-app-build.gradle"), "utf8");
const EXPO_TIMEOUT = 60_000;

type ExpoConfig = { android?: { package?: string }; plugins?: (string | [string, Record<string, unknown>?])[] };

function expoConfig(): ExpoConfig {
  const child = spawnSync("pnpm", ["exec", "expo", "config", "--json"], {
    cwd: join(repo, "apps", "tv"),
    encoding: "utf8",
    timeout: EXPO_TIMEOUT,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, EXPO_NO_TELEMETRY: "1", EXPO_OFFLINE: "1", CI: "1" },
  });
  expect(child.error, `expo config could not start: ${child.error?.message}`).toBeUndefined();
  expect(child.status, `expo config failed:\n${child.stdout}\n${child.stderr}`).toBe(0);
  const out = child.stdout;
  return JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as ExpoConfig;
}

describe("the application ID and the Kotlin package", () => {
  it("T3-21 item 7: the core defines the owner's application ID", () => {
    expect(ANDROID_APPLICATION_ID).toBe("cloud.jellyscale.octave");
  });

  it(
    "T3-21 item 7: the resolved Expo config keeps dev.octave.tv as the Kotlin package and hands the core's ID to the signing plugin",
    () => {
      const config = expoConfig();
      expect(config.android?.package).toBe("dev.octave.tv");
      const entry = (config.plugins ?? []).find((plugin) => String(Array.isArray(plugin) ? plugin[0] : plugin).endsWith("with-release-signing.js"));
      expect(entry, "the signing plugin is listed").toBeDefined();
      expect(Array.isArray(entry) ? entry[1]?.applicationId : undefined).toBe(ANDROID_APPLICATION_ID);
    },
    EXPO_TIMEOUT + 30_000,
  );

  it("T3-21 item 7: the plugin keeps the namespace dev.octave.tv and sets the application ID it is given", () => {
    const plugin = require("../apps/tv/plugins/with-release-signing.js") as { addReleaseSigning(contents: string, options: { applicationId: string }): string };
    const out = plugin.addReleaseSigning(TEMPLATE, { applicationId: ANDROID_APPLICATION_ID });
    expect(out).toContain("namespace 'dev.octave.tv'");
    expect(out).toMatch(/setApplicationId\(\s*["']cloud\.jellyscale\.octave["']\s*\)/);
    // It runs after Expo's defaultConfig, so its value is the last one set.
    expect(out.indexOf("setApplicationId(")).toBeGreaterThan(out.indexOf("defaultConfig"));
  });

  it("T3-21 item 7: the plugin holds no application ID literal of its own", () => {
    const source = readFileSync(join(repo, "apps", "tv", "plugins", "with-release-signing.js"), "utf8");
    expect(source).not.toContain("cloud.jellyscale.octave");
  });
});
