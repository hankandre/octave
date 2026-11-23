// @vitest-environment node
// T3-21 item 3 (docs/specs/T3-21.md, "Test plan"): a check reads the signing certificate of a built APK with
// apksigner and fails on the template's public debug certificate. The judge runs on recorded apksigner output; the CLI
// runs against a fake Android SDK whose apksigner prints a recording.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name: string): string => readFileSync(join(repo, "scripts", "fixtures", "tv", "signing", name), "utf8");

// Recorded with apksigner verify --print-certs: today's e2e APK (debug key), an APK signed with a throwaway key, and the
// text apksigner prints for a file that is not an APK.
const DEBUG = fixture("apksigner-debug.txt");
const THROWAWAY = fixture("apksigner-throwaway.txt");
const UNVERIFIED = fixture("apksigner-unverified.txt");
const DEBUG_DIGEST = "fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c";
const OTHER_DIGEST = "72bc6f6a4ace5d716353cc069e972402aa463208260d55651b2c4282c88b0dae";

type Judge = (text: string) => string[];
type Module = { judgeCerts: Judge; DEBUG_CERT_SHA256: string };
const load = (): Promise<Module> => import("./tv-apk-signing.mjs") as Promise<Module>;

function expectRefusal(errors: string[], reason: RegExp): void {
  expect(errors.length).toBeGreaterThanOrEqual(1);
  for (const error of errors) expect(error).toMatch(/^ERROR tv /);
  expect(errors.join("\n")).toMatch(reason);
}

describe("judgeCerts", () => {
  it("T3-21 item 3: pins the template's debug certificate by its SHA-256", async () => {
    const { DEBUG_CERT_SHA256 } = await load();
    expect(DEBUG_CERT_SHA256.replaceAll(":", "").toLowerCase()).toBe(DEBUG_DIGEST);
  });

  it("T3-21 item 3: fails today's debug-signed e2e APK", async () => {
    const { judgeCerts } = await load();
    expectRefusal(judgeCerts(DEBUG), /debug/i);
  });

  it("T3-21 item 3: passes an APK signed with a throwaway key", async () => {
    const { judgeCerts } = await load();
    expect(judgeCerts(THROWAWAY)).toEqual([]);
  });

  it("T3-21 item 3: fails an APK apksigner could not verify", async () => {
    const { judgeCerts } = await load();
    expectRefusal(judgeCerts(UNVERIFIED), /./);
    expectRefusal(judgeCerts("DOES NOT VERIFY\nERROR: JAR signer META-INF/CERT.RSA: JAR signature META-INF/CERT.SF indicates the APK is not signed\n"), /./);
  });

  it("T3-21 item 3: fails output with no signer, and empty output (fails closed)", async () => {
    const { judgeCerts } = await load();
    expectRefusal(judgeCerts("Verifies\n"), /./);
    expectRefusal(judgeCerts(""), /./);
    expectRefusal(judgeCerts("some text apksigner never prints\n"), /./);
  });

  it("T3-21 item 3: fails a signer whose distinguished name is the SDK's debug key, whatever its digest", async () => {
    const { judgeCerts } = await load();
    const otherMachine = DEBUG.replace(DEBUG_DIGEST, OTHER_DIGEST);
    expect(otherMachine).not.toBe(DEBUG);
    expectRefusal(judgeCerts(otherMachine), /debug/i);
  });

  it("T3-21 item 3: fails a signer whose digest is the template's, whatever its distinguished name", async () => {
    const { judgeCerts } = await load();
    const renamed = THROWAWAY.replace(OTHER_DIGEST, DEBUG_DIGEST);
    expect(renamed).not.toBe(THROWAWAY);
    expectRefusal(judgeCerts(renamed), /debug/i);
  });

  it("T3-21 item 3: reads the Signer #N form as well as the V2 form", async () => {
    const { judgeCerts } = await load();
    const numbered = (dn: string, digest: string) => `Signer #1 certificate DN: ${dn}\nSigner #1 certificate SHA-256 digest: ${digest}\n`;
    expect(judgeCerts(numbered("CN=Octave Throwaway, O=Octave CI", OTHER_DIGEST))).toEqual([]);
    expectRefusal(judgeCerts(numbered("CN=Android Debug, OU=Android, O=Unknown, L=Unknown, ST=Unknown, C=US", DEBUG_DIGEST)), /debug/i);
  });

  it("T3-21 item 3: fails when any one of several signers is the debug key", async () => {
    const { judgeCerts } = await load();
    expectRefusal(judgeCerts(`${THROWAWAY}${DEBUG}`), /debug/i);
  });

  it("T3-21 item 3: fails a signer with a name but no readable digest", async () => {
    const { judgeCerts } = await load();
    expectRefusal(judgeCerts("V3.0 Signer: certificate DN: CN=Octave Throwaway, O=Octave CI\n"), /./);
  });
});

describe("the CLI, through an apksigner in a fake SDK", () => {
  let work: string;
  let sdk: string;
  let apk: string;

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "octave-apk-signing-"));
    sdk = join(work, "sdk");
    apk = join(work, "app.apk");
    writeFileSync(apk, "not really an apk");
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  // An apksigner that prints `text` (to stdout, or to stderr when `stream` is "stderr") and exits with `status`.
  function fakeSdk(text: string, status: number, stream: "stdout" | "stderr" = "stdout"): void {
    const dir = join(sdk, "build-tools", "99.0.0");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "apksigner");
    writeFileSync(path, `#!${process.execPath}\nprocess.${stream}.write(${JSON.stringify(text)});\nprocess.exitCode = ${status};\n`);
    chmodSync(path, 0o755);
  }

  function run(): { status: number | null; output: string } {
    const result = spawnSync(process.execPath, [join(repo, "scripts", "tv-apk-signing.mjs"), apk], {
      encoding: "utf8",
      env: { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk },
      timeout: 60_000,
    });
    return { status: result.status, output: result.stdout + result.stderr };
  }

  it("T3-21 item 3: exits 1 on a debug-signed APK and says so", () => {
    fakeSdk(DEBUG, 0);
    const result = run();
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/ERROR tv /);
    expect(result.output).toMatch(/debug/i);
  });

  it("T3-21 item 3: exits 0 on an APK signed with a throwaway key", () => {
    fakeSdk(THROWAWAY, 0);
    const result = run();
    expect(result.status, result.output).toBe(0);
  });

  it("T3-21 item 3: exits 1 when apksigner itself fails, whatever it printed", () => {
    fakeSdk(UNVERIFIED, 1, "stderr");
    const unverified = run();
    expect(unverified.status).toBe(1);
    expect(unverified.output).toMatch(/ERROR tv /);
    fakeSdk(THROWAWAY, 1);
    const failed = run();
    expect(failed.status).toBe(1);
    expect(failed.output).toMatch(/ERROR tv /);
  });
});

describe("where the check runs", () => {
  const strip = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("T3-21 item 3: pnpm tv:apk:check ends with the certificate check", () => {
    const scripts = (JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
    const steps = scripts["tv:apk:check"].split("&&").map((step) => step.trim());
    expect(steps[steps.length - 1]).toBe("node scripts/tv-apk-signing.mjs");
  });

  it("T3-21 item 3: pnpm tv:e2e judges the e2e APK's certificate before it installs", () => {
    const source = strip(readFileSync(join(repo, "scripts", "tv-e2e.mjs"), "utf8"));
    const judge = source.search(/\b(judgeCerts|readCerts)\(/);
    const install = source.indexOf('"install"');
    expect(judge, "tv-e2e.mjs reads or judges the certificate").toBeGreaterThanOrEqual(0);
    expect(install, "tv-e2e.mjs installs").toBeGreaterThanOrEqual(0);
    expect(judge).toBeLessThan(install);
  });
});
