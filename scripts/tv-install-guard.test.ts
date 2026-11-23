// @vitest-environment node
// T3-21 item 4 (docs/specs/T3-21.md, "Test plan"): no script installs a debuggable APK, or one signed with the debug
// certificate, on a device that is not positively an emulator (docs/security.md, Development builds). The decision is
// installRefusal({ emulator, badging, certs }); pnpm tv:smoke is run through a fake adb and a fake SDK; every install
// site calls the guard before its adb install.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFakeSmokeAdb } from "./fixtures/tv/fake-smoke-adb";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts: string[]): string => readFileSync(join(repo, ...parts), "utf8");

const RELEASE_BADGING = read("scripts", "fixtures", "tv", "badging-release.txt");
const DEBUGGABLE_BADGING = `${RELEASE_BADGING.replace(/\n*$/, "\n")}application-debuggable\n`;
const DEBUG_CERTS = read("scripts", "fixtures", "tv", "signing", "apksigner-debug.txt");
const OWN_CERTS = read("scripts", "fixtures", "tv", "signing", "apksigner-throwaway.txt");

type Guard = {
  installRefusal(facts: { emulator: boolean | undefined; badging: string; certs: string }): string | null | undefined;
  probeStageDecision(facts: { emulator: boolean | undefined; mustRun: boolean }): "run" | "skip" | "fail";
};
const load = (): Promise<Guard> => import("./tv-install-guard.mjs") as Promise<Guard>;

describe("installRefusal: the decision table", () => {
  it("T3-21 item 4: the fixture badging is not debuggable and the added line makes it so (the premise)", () => {
    expect(RELEASE_BADGING).not.toMatch(/application-debuggable/);
    expect(DEBUGGABLE_BADGING).toMatch(/^application-debuggable$/m);
  });

  const rows: { emulator: boolean; debuggable: boolean; debugCert: boolean }[] = [];
  for (const emulator of [true, false]) {
    for (const debuggable of [true, false]) {
      for (const debugCert of [true, false]) rows.push({ emulator, debuggable, debugCert });
    }
  }

  it.each(rows)("T3-21 item 4: emulator $emulator, debuggable $debuggable, debug certificate $debugCert", async ({ emulator, debuggable, debugCert }) => {
    const { installRefusal } = await load();
    const refusal = installRefusal({
      emulator,
      badging: debuggable ? DEBUGGABLE_BADGING : RELEASE_BADGING,
      certs: debugCert ? DEBUG_CERTS : OWN_CERTS,
    });
    const refused = !emulator && (debuggable || debugCert);
    if (!refused) {
      expect(Boolean(refusal), `unexpected refusal: ${refusal}`).toBe(false);
      return;
    }
    expect(typeof refusal).toBe("string");
    expect(refusal).toMatch(/^ERROR tv /);
    if (debuggable) expect(refusal).toMatch(/debuggable/i);
    else expect(refusal).toMatch(/debug (key|certificate)/i);
  });

  it("T3-21 item 4: a device that cannot be read counts as not an emulator", async () => {
    const { installRefusal } = await load();
    expect(installRefusal({ emulator: undefined, badging: DEBUGGABLE_BADGING, certs: OWN_CERTS })).toMatch(/debuggable/i);
    expect(installRefusal({ emulator: undefined, badging: RELEASE_BADGING, certs: DEBUG_CERTS })).toMatch(/debug (key|certificate)/i);
  });
});

describe("the e2e probe stages", () => {
  it.each([
    [true, false, "run"],
    [true, true, "run"],
    [false, false, "skip"],
    [undefined, false, "skip"],
    [false, true, "fail"],
    [undefined, true, "fail"],
  ] as const)("T3-21 item 4: emulator %s, run required %s gives %s", async (emulator, mustRun, expected) => {
    const { probeStageDecision } = await load();
    expect(probeStageDecision({ emulator, mustRun })).toBe(expected);
  });
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe("pnpm tv:smoke on a device that is not an emulator", () => {
  let work: string;
  let sdk: string;
  let evidence: string;
  let apk: string;
  const SERIAL = "192.0.2.44:5555";

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "octave-install-guard-"));
    sdk = join(work, "sdk");
    evidence = join(work, "evidence");
    apk = join(work, "app-release.apk");
    writeFileSync(apk, "not really an apk");
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  // A fake SDK: aapt2 prints `badging` for `dump badging`; apksigner prints `certs`.
  function fakeSdk(badging: string, certs: string): void {
    const dir = join(sdk, "build-tools", "99.0.0");
    mkdirSync(dir, { recursive: true });
    const tool = (name: string, body: string) => {
      writeFileSync(join(dir, name), `#!${process.execPath}\n${body}\n`);
      chmodSync(join(dir, name), 0o755);
    };
    tool("aapt2", `process.stdout.write(${JSON.stringify(badging)});`);
    tool("apksigner", `process.stdout.write(${JSON.stringify(certs)});`);
  }

  async function smoke(badging: string, certs: string): Promise<{ status: number | null; output: string; adbCalls: string[][] }> {
    fakeSdk(badging, certs);
    const port = await freePort();
    // getprop answers nothing, so the device is not an emulator.
    const made = writeFakeSmokeAdb({ serial: SERIAL, port, appId: "cloud.jellyscale.octave", control: "connect" });
    try {
      const child = spawnSync(process.execPath, [join(repo, "scripts", "fixtures", "tv", "smoke-child.mjs"), String(port), evidence, made.adb, apk], {
        encoding: "utf8",
        env: { ...process.env, SMOKE_SERIAL: SERIAL, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk },
        timeout: 90_000,
      });
      const adbCalls = readFileSync(made.log, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]);
      return { status: child.status, output: child.stdout + child.stderr, adbCalls };
    } finally {
      rmSync(made.dir, { recursive: true, force: true });
    }
  }

  const installed = (calls: string[][]): boolean => calls.some((args) => args.includes("install"));

  it("T3-21 item 4: refuses a debuggable APK before any install reaches adb", async () => {
    const result = await smoke(DEBUGGABLE_BADGING, OWN_CERTS);
    expect(installed(result.adbCalls), "no install reached adb").toBe(false);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/debuggable/i);
    expect(result.output, "the serial is not printed").not.toContain("192.0.2.44");
  }, 120_000);

  it("T3-21 item 4: refuses an APK signed with the debug certificate before any install reaches adb", async () => {
    const result = await smoke(RELEASE_BADGING, DEBUG_CERTS);
    expect(installed(result.adbCalls), "no install reached adb").toBe(false);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/debug (key|certificate)/i);
  }, 120_000);
});

describe("every install site calls the guard first", () => {
  const strip = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it.each(["tv-e2e.mjs", "tv-first-focus.mjs", "tv-wire.mjs", "tv-cleartext.mjs", "tv-resolved-address.mjs"])("T3-21 item 4: %s calls installRefusal before its install", (name) => {
    const source = strip(read("scripts", name));
    const install = source.indexOf('"install"');
    const guard = source.search(/\binstallRefusal\(/);
    expect(install, `${name} installs`).toBeGreaterThanOrEqual(0);
    expect(guard, `${name} calls installRefusal`).toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(install);
  });
});
