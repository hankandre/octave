// @vitest-environment node
// T3-37 item 1 (docs/specs/T3-37.md, Test plan): a serial that names a device by host name, mDNS name or USB serial has
// the addresses the device holds learned before the device is used, and every one is replaced by `[device]`. A host or
// mDNS serial whose addresses cannot be learned is refused with one line that names no form of the serial. Fixture
// addresses: RFC 5737 and RFC 3849 only; host names end `.invalid`.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { ANDROID_APPLICATION_ID } from "../packages/core/src/domain/app-identity";
import { IP_OUTPUT, isLearningCall, writeFakeNamedAdb } from "./fixtures/tv/fake-named-adb";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHILD = join(repo, "scripts", "fixtures", "tv", "smoke-child.mjs");
const TIMEOUT = 120_000;

const HOST_SERIAL = "tv.invalid:5555";
const MDNS_SERIAL = "adb-OCTAVE01-x7Qz9k._adb-tls-connect._tcp";
const USB_SERIAL = "tv-serial-1";

type Runner = { run(args: string[]): { status: number; stdout: string; stderr: string } };
type Lookup = (name: string) => Promise<{ address: string; family: number }[]>;
type AdbModule = {
  openAdb(options: { adbPath: string; serial: string; addresses?: string[] }): Runner;
  openDeviceAdb(options: { adbPath: string; serial: string; lookup?: Lookup }): Promise<Runner>;
};
type AddressesModule = { serialKind(serial: string): string };

const load = async (): Promise<AdbModule> => (await import(pathToFileURL(join(repo, "scripts", "tv-adb.mjs")).href)) as AdbModule;
const loadAddresses = async (): Promise<AddressesModule> => (await import(pathToFileURL(join(repo, "scripts", "tv-adb-addresses.mjs")).href)) as AddressesModule;

const temps: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const answers = (address: string): Lookup => async () => [{ address, family: address.includes(":") ? 6 : 4 }];
const rejects: Lookup = async () => {
  throw new Error("queryA ENOTFOUND");
};

describe("T3-37 item 1: the kinds of serial", () => {
  const kinds: [string, string][] = [
    ["emulator-5554", "emulator"],
    ["192.0.2.44:5555", "address"],
    ["192.0.2.44", "address"],
    ["[2001:db8::7]:5555", "address"],
    ["2001:db8::7", "address"],
    [MDNS_SERIAL, "mdns"],
    [`${MDNS_SERIAL}.`, "mdns"],
    ["shield.example:5555", "host"],
    ["tv.local", "host"],
    [HOST_SERIAL, "host"],
    [USB_SERIAL, "other"],
    ["R58M123ABCD", "other"],
  ];
  for (const [serial, kind] of kinds) {
    it(`T3-37 item 1: serialKind(${serial}) is ${kind}`, async () => {
      expect((await loadAddresses()).serialKind(serial)).toBe(kind);
    });
  }
});

describe("T3-37 item 1: openDeviceAdb learns a named serial's addresses", () => {
  it("T3-37 item 1: a host serial has the device's interface addresses and the resolver's answer replaced in any spelling", async () => {
    const fake = writeFakeNamedAdb({ ip: IP_OUTPUT });
    const runner = await (await load()).openDeviceAdb({ adbPath: fake.adb, serial: HOST_SERIAL, lookup: answers("198.51.100.20") });
    const result = runner.run(["echo", "seen 192.0.2.44 and [2001:db8::7]:5555 and 198.51.100.20 and 2001:0db8:0:0:0:0:0:7 and 198.51.100.9 and 192.0.2.99 and 127.0.0.1"]);
    for (const address of ["192.0.2.44", "2001:db8::7", "2001:0db8:0:0:0:0:0:7", "198.51.100.20", "198.51.100.9"]) {
      expect(result.stdout, address).not.toContain(address);
    }
    expect(result.stdout).toContain("[device]");
    // An address the device does not hold and a loopback address are not replaced.
    expect(result.stdout).toContain("192.0.2.99");
    expect(result.stdout).toContain("127.0.0.1");
  }, TIMEOUT);

  it("T3-37 item 1: an interface listing gives its four non-loopback addresses, link-local among them", async () => {
    const fake = writeFakeNamedAdb({ ip: IP_OUTPUT });
    const runner = await (await load()).openDeviceAdb({ adbPath: fake.adb, serial: USB_SERIAL });
    const result = runner.run(["echo", "192.0.2.44 2001:db8::7 fe80::1234 198.51.100.9 ::1 127.0.0.1 192.0.2.255"]);
    expect(result.stdout.trim()).toBe("[device] [device] [device] [device] ::1 127.0.0.1 192.0.2.255");
  }, TIMEOUT);

  it("T3-37 item 1: an mDNS serial has the address of its own instance in adb's list replaced, and no other instance's", async () => {
    const mdns = [
      "List of discovered mdns services",
      "adb-OCTAVE01-x7Qz9k\t_adb-tls-connect._tcp\t192.0.2.46:37123",
      "adb-OTHER02-abc123\t_adb-tls-connect._tcp\t192.0.2.47:40001",
      "",
    ].join("\n");
    const fake = writeFakeNamedAdb({ ip: "", mdns });
    const runner = await (await load()).openDeviceAdb({ adbPath: fake.adb, serial: MDNS_SERIAL });
    const result = runner.run(["echo", "from 192.0.2.46 and from 192.0.2.47"]);
    expect(result.stdout).not.toContain("192.0.2.46");
    expect(result.stdout).toContain("192.0.2.47");
    expect(result.stdout).toContain("[device]");
  }, TIMEOUT);

  it("T3-37 item 1: a host serial whose addresses cannot be learned is refused without naming the serial, and nothing else runs", async () => {
    const fake = writeFakeNamedAdb({});
    const failure = await (await load()).openDeviceAdb({ adbPath: fake.adb, serial: HOST_SERIAL, lookup: rejects }).then(
      () => null,
      (error: unknown) => error as Error,
    );
    expect(failure, "openDeviceAdb rejects").not.toBeNull();
    expect(failure?.message).toMatch(/could not be learned/);
    expect(failure?.message).not.toMatch(/tv\.invalid/i);
    expect(failure?.message).not.toContain("5555");
    expect(fake.calls().filter((call) => !isLearningCall(call))).toEqual([]);
  }, TIMEOUT);

  it("T3-37 item 1: an mDNS serial whose addresses cannot be learned is refused without naming the serial", async () => {
    const fake = writeFakeNamedAdb({ ip: "", mdns: "List of discovered mdns services\n" });
    const failure = await (await load()).openDeviceAdb({ adbPath: fake.adb, serial: MDNS_SERIAL }).then(
      () => null,
      (error: unknown) => error as Error,
    );
    expect(failure, "openDeviceAdb rejects").not.toBeNull();
    expect(failure?.message).toMatch(/could not be learned/);
    expect(failure?.message).not.toMatch(/OCTAVE01|x7Qz9k/i);
    expect(fake.calls().filter((call) => !isLearningCall(call))).toEqual([]);
  }, TIMEOUT);

  it("T3-37 item 1: a USB-style serial that learns nothing is not refused", async () => {
    const fake = writeFakeNamedAdb({});
    const runner = await (await load()).openDeviceAdb({ adbPath: fake.adb, serial: USB_SERIAL });
    expect(runner.run(["echo", "ok"]).stdout.trim()).toBe("ok");
  }, TIMEOUT);

  for (const serial of ["emulator-5554", "192.0.2.44:5555"]) {
    it(`T3-37 item 1: ${serial} makes no learning call`, async () => {
      const fake = writeFakeNamedAdb({});
      const runner = await (await load()).openDeviceAdb({ adbPath: fake.adb, serial, lookup: rejects });
      expect(fake.calls()).toEqual([]);
      expect(runner.run(["echo", "ok"]).stdout.trim()).toBe("ok");
    }, TIMEOUT);
  }

  for (const serial of [HOST_SERIAL, MDNS_SERIAL]) {
    it(`T3-37 item 1: openAdb without addresses throws for ${serial.startsWith("adb-") ? "an mDNS serial" : "a host serial"}, and the message names no form of it`, async () => {
      const fake = writeFakeNamedAdb({});
      const { openAdb } = await load();
      let message = "";
      try {
        openAdb({ adbPath: fake.adb, serial });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/openDeviceAdb/);
      expect(message).not.toMatch(/tv\.invalid|OCTAVE01|x7Qz9k/i);
      expect(fake.calls()).toEqual([]);
    });
  }
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function evidenceFiles(dir: string): { name: string; text: string }[] {
  return readdirSync(dir)
    .filter((name) => !name.endsWith(".png"))
    .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
}

async function smokeChild(options: Parameters<typeof writeFakeNamedAdb>[0]) {
  const port = await freePort();
  const fake = writeFakeNamedAdb({ port, appId: ANDROID_APPLICATION_ID, emulator: true, control: "connect", ...options });
  const evidence = temp("octave-named-evidence-");
  const apk = join(fake.dir, "app.apk");
  writeFileSync(apk, "apk");
  const child = spawnSync(process.execPath, [CHILD, String(port), evidence, fake.adb, apk], {
    encoding: "utf8",
    env: { ...process.env, SMOKE_SERIAL: HOST_SERIAL },
    timeout: 100_000,
  });
  return { child, fake, evidence, console: `${child.stdout}\n${child.stderr}` };
}

describe("T3-37 item 1: the smoke CLI with a named serial", () => {
  it("T3-37 item 1: a learned address in a logcat line, the resolve answer and a control's failure reaches no console line or evidence file", async () => {
    // The fake's own texts carry 192.0.2.44, which the device's interface list also holds.
    const { evidence, console: output } = await smokeChild({ ip: IP_OUTPUT, serial: "192.0.2.44", control: "fail-named", leakIntoOutput: true });
    expect(output).not.toContain("192.0.2.44");
    const files = evidenceFiles(evidence);
    for (const file of files) expect(file.text, file.name).not.toContain("192.0.2.44");
    const watch = files.find((file) => file.name === "dev-server-watch.txt");
    expect(watch, "dev-server-watch.txt is written").toBeDefined();
    expect(watch?.text).toContain("[device]");
    const transcript = files.find((file) => file.name === "first-focus.txt");
    expect(transcript?.text ?? "").toContain("[device]");
  }, TIMEOUT);

  it("T3-37 item 1: a host serial whose addresses cannot be learned exits 1 with one ERROR line, no form of the serial, and no install", async () => {
    const { child, fake, console: output } = await smokeChild({});
    expect(child.status, output).toBe(1);
    const errors = output.split("\n").filter((line) => line.startsWith("ERROR"));
    expect(errors, output).toHaveLength(1);
    expect(errors[0]).toMatch(/could not be learned/);
    expect(output).not.toMatch(/tv\.invalid/i);
    expect(fake.calls().some((call) => call.includes("install"))).toBe(false);
    expect(readFileSync(fake.smokeLog, "utf8")).not.toContain("install");
  }, TIMEOUT);
});
