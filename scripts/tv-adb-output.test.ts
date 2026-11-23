// @vitest-environment node
// T3-30 item 1, the named test (docs/specs/T3-30.md, Test plan): adb errors that name a network-adb serial reach no
// console line, thrown error or file under the evidence directory. The smoke CLI runs in a child process against a fake
// adb, and the two probes run in this process. Fixture addresses: RFC 5737 only.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { ANDROID_APPLICATION_ID } from "../packages/core/src/domain/app-identity";
import { type FakeSmokeOptions, writeFakeSmokeAdb } from "./fixtures/tv/fake-smoke-adb";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHILD = join(repo, "scripts", "fixtures", "tv", "smoke-child.mjs");
const SERIAL = "192.0.2.44:5555";
const HOST = "192.0.2.44";
const TIMEOUT = 120_000;

const temps: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function files(dir: string): { name: string; text: string }[] {
  return readdirSync(dir)
    .filter((name) => !name.endsWith(".png"))
    .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
}

async function smokeChild(options: Partial<FakeSmokeOptions> & Pick<FakeSmokeOptions, "control">) {
  const port = await freePort();
  const fake = writeFakeSmokeAdb({ serial: SERIAL, port, appId: ANDROID_APPLICATION_ID, emulator: true, ...options });
  const evidence = temp("octave-smoke-evidence-");
  const apk = join(fake.dir, "app.apk");
  writeFileSync(apk, "apk");
  const child = spawnSync(process.execPath, [CHILD, String(port), evidence, fake.adb, apk], {
    encoding: "utf8",
    env: { ...process.env, SMOKE_SERIAL: SERIAL },
    timeout: 100_000,
  });
  return { child, evidence, console: `${child.stdout}\n${child.stderr}` };
}

describe("T3-30 item 1: the smoke CLI holds no device address", () => {
  it("T3-30 item 1: a failed control that names the serial leaves it out of the console and every evidence file", async () => {
    const { child, evidence, console: output } = await smokeChild({ control: "fail-named" });
    expect(child.status, output).toBe(1);
    expect(output).not.toContain(HOST);
    expect(output).not.toContain(SERIAL);
    for (const file of files(evidence)) {
      expect(file.text, file.name).not.toContain(HOST);
      expect(file.text, file.name).not.toContain(SERIAL);
    }
    const watch = files(evidence).find((file) => file.name === "dev-server-watch.txt");
    expect(watch, "dev-server-watch.txt is written").toBeDefined();
    expect(watch?.text).toContain("[device]");
  }, TIMEOUT);

  it("T3-30 item 1: a failed reverse that names the serial reaches the console as [device]", async () => {
    const { child, console: output } = await smokeChild({ control: "connect", reverse: "fail-named" });
    expect(child.status, output).toBe(1);
    expect(output).not.toContain(HOST);
    expect(output).toContain("[device]");
  }, TIMEOUT);

  it("T3-30 item 1: a failed install that names the serial reaches the console as [device]", async () => {
    const { child, console: output } = await smokeChild({ control: "connect", install: "fail-named" });
    expect(child.status, output).toBe(1);
    expect(output).not.toContain(HOST);
    expect(output).toContain("[device]");
  }, TIMEOUT);

  it("T3-30 item 1: the serial inside a logcat line and the resolve answer is out of first-focus.txt and the console", async () => {
    const { evidence, console: output } = await smokeChild({ control: "connect", leakIntoOutput: true });
    expect(output).not.toContain(HOST);
    const transcript = files(evidence).find((file) => file.name === "first-focus.txt");
    expect(transcript, "first-focus.txt is written").toBeDefined();
    expect(transcript?.text).not.toContain(HOST);
    expect(transcript?.text).toContain("[device]");
    for (const file of files(evidence)) expect(file.text, file.name).not.toContain(HOST);
  }, TIMEOUT);
});

type ProbeModule = {
  runCleartextProbe(options: { adbPath: string; serial: string; apk: string; evidenceDir: string }): Promise<{ errors: string[] }>;
  runResolvedAddressProbe?(options: { adbPath: string; serial: string; apk: string; evidenceDir: string }): Promise<{ errors: string[] }>;
};

const importProbe = async (name: string) => (await import(pathToFileURL(join(repo, "scripts", name)).href)) as ProbeModule;

describe("T3-30 item 1: the probes hold no device address", () => {
  // Each probe reports the serial in a value of a key its evidence file writes.
  const instrumentFor = (key: string) => ["INSTRUMENTATION_RESULT: done=yes", `INSTRUMENTATION_RESULT: ${key}=failed-${SERIAL}`, "INSTRUMENTATION_CODE: -1"].join("\n");

  for (const [label, module, run, evidenceName, key] of [
    ["the cleartext probe", "tv-cleartext.mjs", "runCleartextProbe", "e2e-cleartext.txt", "public-other"],
    ["the resolved-address probe", "tv-resolved-address.mjs", "runResolvedAddressProbe", "e2e-resolved-address.txt", "resolved-private"],
  ] as const) {
    for (const failing of ["reverse", "install"] as const) {
      // The resolved-address probe runs no reverse.
      if (run === "runResolvedAddressProbe" && failing === "reverse") continue;
      it(`T3-30 item 1: ${label} with a failed ${failing} that names the serial returns and writes no form of it`, async () => {
        const fake = writeFakeSmokeAdb({
          serial: SERIAL,
          port: 1,
          appId: ANDROID_APPLICATION_ID,
          emulator: true,
          control: "connect",
          reverse: failing === "reverse" ? "fail-named" : "ok",
          install: failing === "install" ? "fail-named" : "ok",
        });
        const evidenceDir = temp("octave-probe-evidence-");
        const result = await (await importProbe(module))[run]?.({ adbPath: fake.adb, serial: SERIAL, apk: join(fake.dir, "p.apk"), evidenceDir });
        expect(result, `${run} is exported`).toBeDefined();
        const returned = (result as { errors: string[] }).errors.join("\n");
        expect(returned).not.toContain(HOST);
        expect(returned).toContain("[device]");
        for (const file of files(evidenceDir)) expect(file.text, file.name).not.toContain(HOST);
      }, TIMEOUT);
    }

    it(`T3-30 item 1: ${label} with the serial in an instrumentation value writes and returns no form of it`, async () => {
      const fake = writeFakeSmokeAdb({ serial: SERIAL, port: 1, appId: ANDROID_APPLICATION_ID, emulator: true, control: "connect", instrument: instrumentFor(key) });
      const evidenceDir = temp("octave-probe-evidence-");
      const result = await (await importProbe(module))[run]?.({ adbPath: fake.adb, serial: SERIAL, apk: join(fake.dir, "p.apk"), evidenceDir });
      expect(result).toBeDefined();
      expect((result as { errors: string[] }).errors.join("\n")).not.toContain(HOST);
      const written = files(evidenceDir).find((file) => file.name === evidenceName);
      expect(written, `${evidenceName} is written`).toBeDefined();
      expect(written?.text).not.toContain(HOST);
      expect(written?.text).toContain("[device]");
    }, TIMEOUT);
  }
});
