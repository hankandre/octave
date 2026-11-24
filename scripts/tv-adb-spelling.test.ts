// @vitest-environment node
// T3-37 item 2 (docs/specs/T3-37.md, Test plan): another spelling of the serial's own address is replaced in the
// console, in thrown errors and in release evidence. The pure function runs in this process; the smoke CLI runs in a
// child process against the frozen fake adb, whose texts spell the IPv6 address another way. Fixture addresses: RFC 5737
// and RFC 3849 only.
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
const TIMEOUT = 120_000;
const SERIAL6 = "[2001:db8::7]:5555";
const OTHER_SPELLING = "2001:0db8:0:0:0:0:0:7";

type AdbModule = { redactSerial(text: string, serial: string): string; openAdb(options: { adbPath: string; serial: string }): { redact(text: string): string } };
const load = async (): Promise<AdbModule> => (await import(pathToFileURL(join(repo, "scripts", "tv-adb.mjs")).href)) as AdbModule;

const temps: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

// Every IPv6 token of `text`, in the canonical form the WHATWG URL parser gives, so another spelling cannot hide.
function ipv6Forms(text: string): string[] {
  const forms: string[] = [];
  for (const match of text.matchAll(/[0-9a-fA-F:.]*:[0-9a-fA-F:.]*:[0-9a-fA-F:.]*/g)) {
    const token = match[0].replace(/\.+$/, "");
    try {
      forms.push(new URL(`http://[${token}]/`).hostname);
    } catch {
      // not an address
    }
  }
  return forms;
}
const holdsAddress = (text: string, canonical: string) => ipv6Forms(text).includes(canonical);

describe("T3-37 item 2: the serial's own IPv6 address in another spelling", () => {
  for (const [label, text] of [
    ["the full spelling", "peer 2001:0db8:0000:0000:0000:0000:0000:0007 closed"],
    ["upper case with a short run of zeros", "peer 2001:DB8:0:0::7 closed"],
    ["in brackets with a port", "peer [2001:db8:0::7]:5555 closed"],
    ["with a zone", "peer 2001:db8::7%wlan0 closed"],
    ["at the end of a sentence", "the device answered from 2001:db8::0:7."],
  ] as const) {
    it(`T3-37 item 2: ${label} is replaced`, async () => {
      const out = (await load()).redactSerial(text, SERIAL6);
      expect(out).toContain("[device]");
      expect(holdsAddress(out, "[2001:db8::7]"), out).toBe(false);
      expect(out).not.toMatch(/db8/i);
    });
  }

  it("T3-37 item 2: the plain redaction of the full spelling is exactly [device]", async () => {
    expect((await load()).redactSerial("2001:0db8:0:0:0:0:0:7", SERIAL6)).toBe("[device]");
  });

  it("T3-37 item 2: an IPv4-mapped IPv6 spelling of an IPv4 serial is replaced", async () => {
    const { redactSerial } = await load();
    expect(redactSerial("from ::ffff:c000:22c up", "192.0.2.44:5555")).toBe("from [device] up");
    expect(redactSerial("from ::FFFF:192.0.2.44 up", "192.0.2.44:5555")).toBe("from [device] up");
  });

  it("T3-37 item 2: the runner's redact applies the same pass", async () => {
    const runner = (await load()).openAdb({ adbPath: "/nonexistent/adb", serial: SERIAL6 });
    expect(runner.redact(`saw ${OTHER_SPELLING} and 2001:db8::8`)).toBe("saw [device] and 2001:db8::8");
  });

  it("T3-37 item 2: another address, a logcat time and a loopback serial's own address are left alone", async () => {
    const { redactSerial } = await load();
    expect(redactSerial("peer 2001:db8::8 closed", SERIAL6)).toBe("peer 2001:db8::8 closed");
    const logcat = "11-24 10:22:33.456  100  100 I ReactNativeJS: OCTAVE_FOCUS tile-0";
    expect(redactSerial(logcat, SERIAL6)).toBe(logcat);
    expect(redactSerial(logcat, "192.0.2.44:5555")).toBe(logcat);
    expect(redactSerial("tcp:8081 via 127.0.0.1", "127.0.0.1:5555")).toBe("tcp:8081 via 127.0.0.1");
  });

  it("T3-37 item 2: T3-30's exact cases still hold", async () => {
    const { redactSerial, openAdb } = await load();
    expect(redactSerial("connect to [2001:db8::7]:5555 failed; 2001:db8::7 is down", SERIAL6)).toBe("connect to [device] failed; [device] is down");
    expect(redactSerial("tcp:8081 via 127.0.0.1 and 127.0.0.1:5555", "127.0.0.1:5555")).toBe("tcp:8081 via 127.0.0.1 and [device]");
    expect(openAdb({ adbPath: "/nonexistent/adb", serial: "192.0.2.44:5555" }).redact("saw 192.0.2.44:5555 and 192.0.2.44")).toBe("saw [device] and [device]");
    expect(redactSerial("::ffff:192.0.2.44 refused", "192.0.2.44:5555")).not.toContain("192.0.2.44");
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

function files(dir: string): { name: string; text: string }[] {
  return readdirSync(dir)
    .filter((name) => !name.endsWith(".png"))
    .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
}

async function smokeChild(options: Partial<FakeSmokeOptions> & Pick<FakeSmokeOptions, "control">) {
  const port = await freePort();
  const fake = writeFakeSmokeAdb({ serial: OTHER_SPELLING, port, appId: ANDROID_APPLICATION_ID, emulator: true, ...options });
  const evidence = temp("octave-spelling-evidence-");
  const apk = join(fake.dir, "app.apk");
  writeFileSync(apk, "apk");
  const child = spawnSync(process.execPath, [CHILD, String(port), evidence, fake.adb, apk], {
    encoding: "utf8",
    env: { ...process.env, SMOKE_SERIAL: SERIAL6 },
    timeout: 100_000,
  });
  return { child, evidence, console: `${child.stdout}\n${child.stderr}` };
}

function expectNoSpelling(output: string, evidence: string) {
  expect(holdsAddress(output, "[2001:db8::7]"), output).toBe(false);
  expect(output).toContain("[device]");
  for (const file of files(evidence)) expect(holdsAddress(file.text, "[2001:db8::7]"), file.name).toBe(false);
}

describe("T3-37 item 2: the smoke CLI with an IPv6 serial the device's texts spell another way", () => {
  it("T3-37 item 2: a failed reverse reaches the console as [device]", async () => {
    const { child, evidence, console: output } = await smokeChild({ control: "connect", reverse: "fail-named" });
    expect(child.status, output).toBe(1);
    expectNoSpelling(output, evidence);
  }, TIMEOUT);

  it("T3-37 item 2: a failed install reaches the console as [device]", async () => {
    const { child, evidence, console: output } = await smokeChild({ control: "connect", install: "fail-named" });
    expect(child.status, output).toBe(1);
    expectNoSpelling(output, evidence);
  }, TIMEOUT);

  it("T3-37 item 2: a failed control and the leaked texts leave first-focus.txt and dev-server-watch.txt without it", async () => {
    const { evidence, console: output } = await smokeChild({ control: "fail-named", leakIntoOutput: true });
    expectNoSpelling(output, evidence);
    const written = files(evidence);
    for (const name of ["first-focus.txt", "dev-server-watch.txt"]) {
      const file = written.find((candidate) => candidate.name === name);
      expect(file, `${name} is written`).toBeDefined();
      expect(file?.text).toContain("[device]");
    }
  }, TIMEOUT);
});

describe("T3-37 item 2: the cleartext probe", () => {
  it("T3-37 item 2: an instrumentation value that spells the address another way is returned and written without it", async () => {
    const instrument = ["INSTRUMENTATION_RESULT: done=yes", `INSTRUMENTATION_RESULT: public-other=failed-${OTHER_SPELLING}`, "INSTRUMENTATION_CODE: -1"].join("\n");
    const fake = writeFakeSmokeAdb({ serial: OTHER_SPELLING, port: 1, appId: ANDROID_APPLICATION_ID, emulator: true, control: "connect", instrument });
    const evidenceDir = temp("octave-spelling-probe-");
    const module = (await import(pathToFileURL(join(repo, "scripts", "tv-cleartext.mjs")).href)) as {
      runCleartextProbe(options: { adbPath: string; serial: string; apk: string; evidenceDir: string }): Promise<{ errors: string[] }>;
    };
    const result = await module.runCleartextProbe({ adbPath: fake.adb, serial: SERIAL6, apk: join(fake.dir, "p.apk"), evidenceDir });
    const returned = result.errors.join("\n");
    expect(holdsAddress(returned, "[2001:db8::7]"), returned).toBe(false);
    const written = files(evidenceDir).find((file) => file.name === "e2e-cleartext.txt");
    expect(written, "e2e-cleartext.txt is written").toBeDefined();
    expect(holdsAddress(written?.text ?? "", "[2001:db8::7]")).toBe(false);
    expect(written?.text).toContain("[device]");
  }, TIMEOUT);
});
