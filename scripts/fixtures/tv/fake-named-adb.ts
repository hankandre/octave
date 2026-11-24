// A fake adb for a named serial (T3-37; docs/specs/T3-37.md, Test plan). It answers the two calls an adb module makes to
// learn a device's addresses, `shell ip -o addr show` and `mdns services`, plus `echo` (it prints its arguments), and
// hands every other call to the frozen `writeFakeSmokeAdb` fake. Its own log holds every call, learning calls included.
// Fixture addresses come from the documentation ranges only (RFC 5737, RFC 3849).
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANDROID_APPLICATION_ID } from "../../../packages/core/src/domain/app-identity";
import { type FakeSmokeOptions, writeFakeSmokeAdb } from "./fake-smoke-adb";

export type FakeNamedOptions = Partial<FakeSmokeOptions> & {
  // What `shell ip -o addr show` prints. Left out: the call prints nothing and exits 1 (the shell user cannot run it).
  ip?: string;
  // What `mdns services` prints. Left out: the call prints nothing and exits 1.
  mdns?: string;
};

export const IP_OUTPUT = [
  "1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever preferred_lft forever",
  "1: lo    inet6 ::1/128 scope host \\       valid_lft forever preferred_lft forever",
  "2: wlan0    inet 192.0.2.44/24 brd 192.0.2.255 scope global wlan0\\       valid_lft forever preferred_lft forever",
  "2: wlan0    inet6 2001:db8::7/64 scope global \\       valid_lft forever preferred_lft forever",
  "2: wlan0    inet6 fe80::1234/64 scope link \\       valid_lft forever preferred_lft forever",
  "3: eth0    inet 198.51.100.9/24 brd 198.51.100.255 scope global eth0\\       valid_lft forever preferred_lft forever",
  "",
].join("\n");

export function writeFakeNamedAdb(options: FakeNamedOptions = {}): { adb: string; dir: string; log: string; smokeLog: string; calls(): string[][] } {
  const { ip, mdns, ...smoke } = options;
  const inner = writeFakeSmokeAdb({ serial: "192.0.2.44", port: 1, appId: ANDROID_APPLICATION_ID, control: "connect", ...smoke });
  const dir = mkdtempSync(join(tmpdir(), "octave-fake-named-adb-"));
  const adb = join(dir, "adb");
  const log = join(dir, "calls.jsonl");
  writeFileSync(log, "");
  writeFileSync(
    adb,
    [
      `#!${process.execPath}`,
      'const fs = require("node:fs");',
      'const { spawnSync } = require("node:child_process");',
      `const o = ${JSON.stringify({ ip: ip ?? null, mdns: mdns ?? null })};`,
      "const args = process.argv.slice(2);",
      `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");`,
      'const rest = args[0] === "-s" ? args.slice(2) : args;',
      'const sh = rest[0] === "shell" ? rest.slice(1).join(" ") : "";',
      'if (rest[0] === "shell" && sh === "ip -o addr show") {',
      "  if (o.ip === null) process.exitCode = 1;",
      "  else process.stdout.write(o.ip);",
      '} else if (rest[0] === "mdns" && rest[1] === "services") {',
      "  if (o.mdns === null) process.exitCode = 1;",
      "  else process.stdout.write(o.mdns);",
      '} else if (rest[0] === "echo") {',
      '  process.stdout.write(rest.slice(1).join(" ") + "\\n");',
      "} else {",
      `  const child = spawnSync(${JSON.stringify(inner.adb)}, args, { stdio: "inherit" });`,
      "  process.exitCode = child.status ?? 1;",
      "}",
      "",
    ].join("\n"),
  );
  chmodSync(adb, 0o755);
  return { adb, dir, log, smokeLog: inner.log, calls: () => readCalls(log) };
}

function readCalls(log: string): string[][] {
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as string[]);
}

// A call that only learns addresses: the interface list or adb's mDNS list.
export const isLearningCall = (call: string[]): boolean => {
  const rest = call[0] === "-s" ? call.slice(2) : call;
  return (rest[0] === "shell" && rest.slice(1).join(" ") === "ip -o addr show") || (rest[0] === "mdns" && rest[1] === "services");
};
