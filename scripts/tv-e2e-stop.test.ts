// @vitest-environment node
// T3-31 item 2 (docs/specs/T3-31.md, "Where the run stops"): `node scripts/tv-e2e.mjs <apk> <probe> <mapping>` runs the
// dex, inspector and native inspector checks on the e2e APK before its first adb command, prints their ERROR lines and
// one `ERROR tv e2e:` line per failed check, exits 1, and installs nothing. Spawned as scripts/tv-apk-inspector-cli.test.ts
// spawns its command.
//
// The temporary SDK: platform-tools/adb appends its arguments to a log and exits 0; build-tools/1.0.0/aapt2 replays
// scripts/fixtures/tv/xmltree-manifest-release.txt, resources-network-security-config.txt and
// xmltree-network-security-config.txt by its arguments, so the network security judgement passes; dexdump prints nothing.
// The APK is bytes that are not a zip, so every check fails. The assertion that the network security line is absent stays
// whatever the fake answers.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(repo, "scripts", "tv-e2e.mjs");
const fixture = (name: string) => join(repo, "scripts", "fixtures", "tv", name);

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function run(options: { mapping: "exists" | "missing" }) {
  const dir = mkdtempSync(join(tmpdir(), "octave-t3-31-stop-"));
  temps.push(dir);
  const sdk = join(dir, "sdk");
  const adbLog = join(dir, "adb.log");
  mkdirSync(join(sdk, "platform-tools"), { recursive: true });
  mkdirSync(join(sdk, "build-tools", "1.0.0"), { recursive: true });
  const script = (path: string, body: string) => {
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
  };
  script(join(sdk, "platform-tools", "adb"), `echo "$@" >> '${adbLog}'\nexit 0`);
  script(
    join(sdk, "build-tools", "1.0.0", "aapt2"),
    [
      `if [ "$2" = "resources" ]; then cat '${fixture("resources-network-security-config.txt")}'; exit 0; fi`,
      `if [ "$2" = "xmltree" ] && [ "$5" = "AndroidManifest.xml" ]; then cat '${fixture("xmltree-manifest-release.txt")}'; exit 0; fi`,
      `if [ "$2" = "xmltree" ]; then cat '${fixture("xmltree-network-security-config.txt")}'; exit 0; fi`,
      "exit 0",
    ].join("\n"),
  );
  script(join(sdk, "build-tools", "1.0.0", "dexdump"), "exit 0");

  const apk = join(dir, "octave-tv-e2e.apk");
  const probe = join(dir, "octave-session-probe.apk");
  const mapping = join(dir, "octave-tv-e2e.mapping.txt");
  writeFileSync(apk, "these bytes are not a zip");
  writeFileSync(probe, "probe");
  if (options.mapping === "exists") writeFileSync(mapping, "# pg_map_id: 0000000\n");

  const env: NodeJS.ProcessEnv = { ...process.env, ANDROID_HOME: sdk, ANDROID_SERIAL: "emulator-0000" };
  delete env.ANDROID_SDK_ROOT;
  const child = spawnSync(process.execPath, [SCRIPT, apk, probe, mapping], { cwd: repo, encoding: "utf8", env, timeout: 90_000 });
  const adbCalls = existsSync(adbLog) ? readFileSync(adbLog, "utf8") : "";
  return { child, adbCalls, mapping };
}

describe("T3-31 item 2: pnpm tv:e2e stops on a failed APK check before it runs adb", () => {
  it("T3-31 item 2: a bad APK exits 1 with the three checks' ERROR lines, then three ERROR tv e2e: lines, and no adb call", () => {
    const { child, adbCalls } = run({ mapping: "exists" });
    expect(child.status, child.stderr).toBe(1);
    const lines = child.stderr.split("\n");
    const at = (prefix: string) => lines.findIndex((line) => line.startsWith(prefix));
    const dex = at("ERROR tv apk dex:");
    const inspector = at("ERROR tv inspector:");
    const native = at("ERROR tv native inspector:");
    expect(dex, child.stderr).toBeGreaterThan(-1);
    expect(inspector, child.stderr).toBeGreaterThan(-1);
    expect(native, child.stderr).toBeGreaterThan(-1);
    const closing = lines.map((line, index) => (line.startsWith("ERROR tv e2e:") ? index : -1)).filter((index) => index >= 0);
    expect(closing, child.stderr).toHaveLength(3);
    for (const index of closing) expect(index).toBeGreaterThan(Math.max(dex, inspector, native));
    expect(child.stderr).not.toContain("the e2e APK does not carry the network security configuration");
    expect(adbCalls).toBe("");
  });

  it("T3-31 item 2: a missing mapping file exits 1 with an ERROR tv e2e: line that says no R8 mapping and names pnpm tv:e2e:build, and no adb call", () => {
    const { child, adbCalls, mapping } = run({ mapping: "missing" });
    expect(child.status, child.stderr).toBe(1);
    const line = child.stderr.split("\n").find((l) => l.startsWith("ERROR tv e2e:") && l.includes("no R8 mapping at"));
    expect(line, child.stderr).toBeDefined();
    expect(line).toContain(mapping);
    expect(line).toContain("pnpm tv:e2e:build");
    expect(adbCalls).toBe("");
  });
});
