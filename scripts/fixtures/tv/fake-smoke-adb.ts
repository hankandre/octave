// A fake adb that plays a whole `pnpm tv:smoke` run (T3-30 fixtures). It answers each call from the options baked into
// it. Fixture addresses come from the documentation ranges only (RFC 5737, RFC 3849).
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type FakeSmokeOptions = {
  serial: string;
  port: number;
  appId: string;
  // `connect`: both controls connect and exit 0. `fail-named`: a control fails with the serial in its message and
  // never connects. `connect-then-fail`: it connects, then exits 1 naming the serial. `slow-fail`: it exits 1 naming the
  // serial after about half a second, without connecting. `fail-10.0.2.2`: only the 10.0.2.2 control fails, at once and without connecting; `slow-fail-10.0.2.2`: the same, after
  // about half a second.
  control: "connect" | "fail-named" | "connect-then-fail" | "slow-fail" | "fail-10.0.2.2" | "slow-fail-10.0.2.2";
  reverse?: "ok" | "fail-named";
  install?: "ok" | "fail-named";
  // Put the serial into the resolved component's neighbouring line and into a logcat line.
  leakIntoOutput?: boolean;
  // The text `am instrument` prints (the probes).
  instrument?: string;
  // `getprop ro.boot.qemu` answers 1, so the install guard (T3-21 item 4) takes the device for an emulator. Without it
  // getprop answers nothing and the device is not an emulator.
  emulator?: boolean;
};

export function writeFakeSmokeAdb(options: FakeSmokeOptions): { adb: string; dir: string; log: string } {
  const dir = mkdtempSync(join(tmpdir(), "octave-fake-smoke-adb-"));
  const adb = join(dir, "adb");
  const log = join(dir, "calls.jsonl");
  const state = join(dir, "pressed");
  writeFileSync(log, "");
  writeFileSync(
    adb,
    [
      `#!${process.execPath}`,
      'const fs = require("node:fs");',
      'const net = require("node:net");',
      `const o = ${JSON.stringify(options)};`,
      "const args = process.argv.slice(2);",
      `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");`,
      "const rest = args.slice(2);",
      "const out = (text) => process.stdout.write(text + '\\n');",
      "const err = (text) => process.stderr.write(text + '\\n');",
      "const fail = (text) => { err(text); process.exitCode = 1; };",
      "const missing = `error: device '${o.serial}' not found`;",
      'const sh = rest[0] === "shell" ? rest.slice(1).join(" ") : "";',
      'const isControl = rest[0] === "shell" && !/^(am|logcat|cmd|log|input|dumpsys|ps|getprop)\\b/.test(sh) && new RegExp("(^|\\\\D)" + o.port + "(\\\\D|$)").test(sh);',
      'if (rest[0] === "get-state") out("device");',
      'else if (rest[0] === "shell" && sh.startsWith("getprop ")) { if (o.emulator === true && sh === "getprop ro.boot.qemu") out("1"); }',
      'else if (rest[0] === "reverse" && rest[1] !== "--remove" && rest[1] !== "--list") { if (o.reverse === "fail-named") fail(missing); }',
      'else if (rest[0] === "install") { if (o.install === "fail-named") fail("adb: failed to connect to " + o.serial); else out("Success"); }',
      'else if (rest[0] === "shell" && sh.startsWith("cmd package resolve-activity")) { if (o.leakIntoOutput) out("matched " + o.serial); out(o.appId + "/.MainActivity"); }',
      'else if (rest[0] === "shell" && sh.startsWith("log -t OCTAVE_PRESS")) fs.writeFileSync(' + JSON.stringify(state) + ', "1");',
      'else if (rest[0] === "shell" && sh.startsWith("logcat -d")) {',
      '  out("11-22 10:00:00.000  100  100 I ReactNativeJS: OCTAVE_FOCUS tile-0");',
      "  if (o.leakIntoOutput) out(\"11-22 10:00:00.100  100  100 I ReactNativeJS: connected to \" + o.serial);",
      "  if (fs.existsSync(" + JSON.stringify(state) + ")) {",
      '    out("11-22 10:00:01.000  100  100 I OCTAVE_PRESS: 1 RIGHT");',
      '    out("11-22 10:00:01.100  100  100 I ReactNativeJS: OCTAVE_FOCUS tile-1");',
      "  }",
      "}",
      'else if (rest[0] === "shell" && sh.startsWith("am instrument")) out(o.instrument ?? "INSTRUMENTATION_CODE: -1");',
      'else if (rest[0] === "exec-out") process.stdout.write(Buffer.from([0x89, 0x50, 0x4e, 0x47]));',
      "else if (isControl) {",
      '  const hostIsEmulatorAlias = sh.includes("10.0.2.2");',
      '  const failsHere = o.control === "fail-named" || o.control === "slow-fail" || o.control === "connect-then-fail" || ((o.control === "fail-10.0.2.2" || o.control === "slow-fail-10.0.2.2") && hostIsEmulatorAlias);',
      '  const connects = o.control === "connect" || o.control === "connect-then-fail" || ((o.control === "fail-10.0.2.2" || o.control === "slow-fail-10.0.2.2") && !hostIsEmulatorAlias);',
      "  const finish = () => { if (failsHere) fail(missing); };",
      "  if (connects) {",
      '    const socket = net.createConnection({ host: "127.0.0.1", port: o.port });',
      '    socket.on("error", () => { process.exitCode = 1; });',
      '    socket.on("close", () => { socket.destroy(); finish(); });',
      "    setTimeout(() => socket.destroy(), 1000).unref();",
      '  } else if (o.control === "slow-fail" || o.control === "slow-fail-10.0.2.2") setTimeout(finish, 500);',
      "  else finish();",
      "}",
      "",
    ].join("\n"),
  );
  chmodSync(adb, 0o755);
  return { adb, dir, log };
}
