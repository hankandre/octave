// @vitest-environment node
// T3-30 item 1, the module half (docs/specs/T3-30.md, "The adb module" and "The forms of a serial"): scripts/tv-adb.mjs is
// the one place that starts adb, and everything it returns has every form of the device serial replaced by `[device]`.
// Fixture addresses come from the documentation ranges only (RFC 5737, RFC 3849).
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT = 30_000;

type Result = { status: number; stdout: string; stderr: string };
type AsyncResult = { code: number; stdout: string; stderr: string; killed: boolean };
type Stream = { stdout: { setEncoding?(encoding: string): void; on(event: string, listener: (chunk: string) => void): void }; on(event: string, listener: (...a: unknown[]) => void): void; kill(): void };
type Runner = {
  run(args: string[], options?: { timeoutMs?: number; maxBuffer?: number }): Result;
  runAsync(args: string[], options?: { timeoutMs?: number; maxBuffer?: number }): Promise<AsyncResult>;
  bytes(args: string[]): { status: number; stdout: Buffer; stderr: string };
  stream(args: string[]): Stream;
  redact(text: string): string;
};
type AdbModule = {
  DEVICE_STAND_IN: string;
  serialForms(serial: string): string[];
  redactSerial(text: string, serial: string): string;
  openAdb(options: { adbPath: string; serial: string }): Runner;
};

async function load(): Promise<AdbModule> {
  return (await import(pathToFileURL(join(repo, "scripts", "tv-adb.mjs")).href)) as AdbModule;
}

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

// A fake adb that echoes its whole argument list (the serial among them) to stdout and stderr. The first argument after
// the serial picks the mode: `echo`, `sleep`, `split` (the serial in two writes) or `bytes`.
function fakeAdb(serialForBytes: string): string {
  const dir = mkdtempSync(join(tmpdir(), "octave-adb-module-"));
  temps.push(dir);
  const adb = join(dir, "adb");
  writeFileSync(
    adb,
    [
      `#!${process.execPath}`,
      "const args = process.argv.slice(2);",
      "const serial = args[1];",
      "const mode = args[2];",
      'if (mode === "sleep") setTimeout(() => {}, 60000);',
      'else if (mode === "split") {',
      "  const half = Math.floor(serial.length / 2);",
      '  process.stdout.write("line one " + serial.slice(0, half));',
      '  setTimeout(() => process.stdout.write(serial.slice(half) + " tail\\nline two\\n"), 150);',
      '} else if (mode === "bytes") {',
      `  process.stdout.write(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]), Buffer.from(${JSON.stringify(serialForBytes)})]));`,
      '  process.stderr.write("error: device \'" + serial + "\' not found\\n");',
      "} else {",
      '  process.stdout.write("out: " + args.join(" ") + "\\n");',
      '  process.stderr.write("error: device \'" + serial + "\' not found\\n");',
      "  process.exitCode = 1;",
      "}",
      "",
    ].join("\n"),
  );
  chmodSync(adb, 0o755);
  return adb;
}

const NETWORK = "192.0.2.44:5555";

describe("T3-30 item 1: the forms of a serial", () => {
  it("T3-30 item 1: an IPv4 address with a port has the serial, the host and the port, and the bare host as forms", async () => {
    const { serialForms, DEVICE_STAND_IN } = await load();
    expect(DEVICE_STAND_IN).toBe("[device]");
    const forms = serialForms(NETWORK);
    expect(forms).toContain("192.0.2.44:5555");
    expect(forms).toContain("192.0.2.44");
    expect(forms.slice().sort((a, b) => b.length - a.length)).toEqual(forms);
  });

  it("T3-30 item 1: an IPv4 address without a port also has the default-port form", async () => {
    const { serialForms } = await load();
    const forms = serialForms("192.0.2.44");
    expect(forms).toContain("192.0.2.44");
    expect(forms).toContain("192.0.2.44:5555");
  });

  it("T3-30 item 1: an IPv6 serial has the bracketed form and the bare address", async () => {
    const { serialForms, redactSerial } = await load();
    const forms = serialForms("[2001:db8::7]:5555");
    expect(forms).toContain("[2001:db8::7]:5555");
    expect(forms).toContain("2001:db8::7");
    expect(redactSerial("connect to [2001:db8::7]:5555 failed; 2001:db8::7 is down", "[2001:db8::7]:5555")).toBe("connect to [device] failed; [device] is down");
  });

  it("T3-30 item 1: a name with a port is replaced in any letter case", async () => {
    const { redactSerial } = await load();
    const text = "failed to connect to TV.Example:5555, then tv.example, then TV.EXAMPLE:5555";
    const out = redactSerial(text, "tv.example:5555");
    expect(out.toLowerCase()).not.toContain("tv.example");
    expect(out).toContain("[device]");
  });

  it("T3-30 item 1: an mDNS serial is replaced with and without the final dot and by its instance part", async () => {
    const { redactSerial } = await load();
    const serial = "adb-R58M12345AB-x7Qz9k._adb-tls-connect._tcp";
    for (const text of [`device '${serial}' not found`, `device '${serial}.' not found`, "instance adb-R58M12345AB-x7Qz9k is gone"]) {
      const out = redactSerial(text, serial);
      expect(out, text).not.toContain("R58M12345AB");
      expect(out).toContain("[device]");
    }
  });

  it("T3-30 item 1: an emulator or USB serial is replaced as given and nothing else is touched", async () => {
    const { redactSerial } = await load();
    expect(redactSerial("device 'emulator-5554' not found; emulator-5556 is up", "emulator-5554")).toBe("device '[device]' not found; emulator-5556 is up");
    expect(redactSerial("usb ZX1G22ABCD offline", "ZX1G22ABCD")).toBe("usb [device] offline");
  });

  it("T3-30 item 1: a loopback serial is replaced as given, but its bare host stays", async () => {
    const { redactSerial } = await load();
    expect(redactSerial("tcp:8081 via 127.0.0.1 and 127.0.0.1:5555", "127.0.0.1:5555")).toBe("tcp:8081 via 127.0.0.1 and [device]");
  });

  it("T3-30 item 1: each wording of a missing network device comes out without any form of the serial", async () => {
    const { redactSerial } = await load();
    const serial = NETWORK;
    const host = "192.0.2.44";
    const wordings = [
      `error: device '${serial}' not found`,
      `adb: device '${serial}' not found`,
      `failed to connect to ${host}:5555`,
      `failed to connect to '${host}:5555': Connection refused`,
      `cannot connect to ${host}.`,
      `${serial} ${serial}`,
      `::ffff:${host} refused`,
      `error: no devices/emulators found for ${host}`,
    ];
    for (const wording of wordings) {
      const out = redactSerial(wording, serial);
      expect(out, wording).not.toContain(host);
      expect(out, wording).toContain("[device]");
    }
  });

  it("T3-30 item 1: a serial too short to replace safely is refused, and the error does not quote it", async () => {
    const { openAdb } = await load();
    let message = "";
    try {
      openAdb({ adbPath: "/nonexistent/adb", serial: "q7z" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("q7z");
  });

  it("T3-30 item 1: a serial whose bare host is too short does not rewrite ordinary words", async () => {
    const { redactSerial } = await load();
    // The floor applies to every form derived from the serial, not only to the serial.
    expect(redactSerial("tvOS 14 resolves tv:5555 and tvOS again", "tv:5555")).toBe("tvOS 14 resolves [device] and tvOS again");
  });
});

describe("T3-30 item 1: openAdb against a fake adb", () => {
  it("T3-30 item 1: run, runAsync and stream return no form of the serial", async () => {
    const { openAdb } = await load();
    const adb = fakeAdb("x");
    const runner = openAdb({ adbPath: adb, serial: NETWORK });

    const sync = runner.run(["echo"]);
    expect(sync.status).toBe(1);
    expect(sync.stdout + sync.stderr).not.toContain("192.0.2.44");
    expect(sync.stdout + sync.stderr).toContain("[device]");
    expect(Object.keys(sync)).not.toContain("error");

    const async_ = await runner.runAsync(["echo"]);
    expect(async_.code).toBe(1);
    expect(async_.stdout + async_.stderr).not.toContain("192.0.2.44");
    expect(async_.stdout + async_.stderr).toContain("[device]");
    expect(Object.keys(async_)).not.toContain("error");

    const stream = runner.stream(["echo"]);
    let text = "";
    stream.stdout.setEncoding?.("utf8");
    stream.stdout.on("data", (chunk) => (text += chunk));
    await new Promise<void>((resolve) => stream.on("exit", () => resolve()));
    expect(text).not.toContain("192.0.2.44");
    expect(text).toContain("[device]");
  }, TIMEOUT);

  it("T3-30 item 1: the arguments the caller gives never hold the serial, and the runner adds it", async () => {
    const { openAdb } = await load();
    const adb = fakeAdb("x");
    const runner = openAdb({ adbPath: adb, serial: "emulator-5554" });
    // The fake echoes `<adb> -s <serial> echo`; its stdout shows the runner passed -s and the serial, redacted.
    expect(runner.run(["echo"]).stdout).toBe("out: -s [device] echo\n");
  }, TIMEOUT);

  it("T3-30 item 1: a missing executable and a timeout give -1 and a stderr without the serial", async () => {
    const { openAdb } = await load();
    const missing = openAdb({ adbPath: join(tmpdir(), "octave-no-such-dir", "adb"), serial: NETWORK });
    const a = missing.run(["echo"]);
    expect(a.status).toBe(-1);
    expect(a.stderr).not.toContain("192.0.2.44");
    expect(Object.keys(a)).not.toContain("error");
    const b = await missing.runAsync(["echo"]);
    expect(b.code).toBe(-1);
    expect(b.stderr).not.toContain("192.0.2.44");

    const slow = openAdb({ adbPath: fakeAdb("x"), serial: NETWORK });
    const timedOut = slow.run(["sleep"], { timeoutMs: 300 });
    expect(timedOut.status).toBe(-1);
    expect(timedOut.stderr).not.toContain("192.0.2.44");
    const killed = await slow.runAsync(["sleep"], { timeoutMs: 300 });
    expect(killed.killed).toBe(true);
    expect(killed.stderr).not.toContain("192.0.2.44");
  }, TIMEOUT);

  it("T3-30 item 1: a stream replaces a serial that arrives split across two writes", async () => {
    const { openAdb } = await load();
    const runner = openAdb({ adbPath: fakeAdb("x"), serial: NETWORK });
    const stream = runner.stream(["split"]);
    const chunks: string[] = [];
    stream.stdout.setEncoding?.("utf8");
    stream.stdout.on("data", (chunk) => chunks.push(chunk));
    await new Promise<void>((resolve) => stream.on("exit", () => resolve()));
    const text = chunks.join("");
    expect(text).toBe("line one [device] tail\nline two\n");
    // Whole lines only: every chunk ends in a newline.
    for (const chunk of chunks) expect(chunk.endsWith("\n"), JSON.stringify(chunk)).toBe(true);
  }, TIMEOUT);

  it("T3-30 item 1: bytes returns the fake's bytes unchanged and a redacted stderr", async () => {
    const { openAdb } = await load();
    const runner = openAdb({ adbPath: fakeAdb(NETWORK), serial: NETWORK });
    const result = runner.bytes(["bytes"]);
    expect(result.status).toBe(0);
    expect(Buffer.isBuffer(result.stdout)).toBe(true);
    expect([...result.stdout.subarray(0, 6)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    expect(result.stdout.subarray(6).toString()).toBe(NETWORK);
    expect(result.stderr).not.toContain("192.0.2.44");
    expect(result.stderr).toContain("[device]");
  }, TIMEOUT);

  it("T3-30 item 1: the runner's redact uses the same forms", async () => {
    const { openAdb } = await load();
    const runner = openAdb({ adbPath: "/nonexistent/adb", serial: NETWORK });
    expect(runner.redact("saw 192.0.2.44:5555 and 192.0.2.44")).toBe("saw [device] and [device]");
  });
});
