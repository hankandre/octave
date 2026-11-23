// @vitest-environment node
// T3-19 item 2 (not frozen): a smoke run that fails after the development server watch has started still removes the
// adb reverse and frees the port (spec, "The watch is stopped before every exit").
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runSmoke } from "./tv-first-focus.mjs";

const temps: string[] = [];
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

async function canBind(port: number): Promise<boolean> {
  const server = createServer();
  const bound = await new Promise<boolean>((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => resolve(true));
  });
  if (bound) await new Promise<void>((resolve) => server.close(() => resolve()));
  return bound;
}

// A fake adb that logs each call, answers every call with exit 0 except `install`, which fails.
function failingInstallAdb(): { adb: string; dir: string; calls: () => string[][] } {
  const dir = mkdtempSync(join(tmpdir(), "octave-fake-adb-"));
  temps.push(dir);
  const log = join(dir, "calls.jsonl");
  const adb = join(dir, "adb");
  writeFileSync(log, "");
  writeFileSync(
    adb,
    [
      `#!${process.execPath}`,
      'const { appendFileSync } = require("node:fs");',
      "const args = process.argv.slice(2);",
      `appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");`,
      'if (args.includes("getprop") && args.includes("ro.boot.qemu")) process.stdout.write("1\\n");',
      'if (args.includes("install")) { process.stderr.write("Failure [INSTALL_FAILED_TEST]\\n"); process.exitCode = 1; }',
      "",
    ].join("\n"),
  );
  chmodSync(adb, 0o755);
  const calls = () =>
    readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
  return { adb, dir, calls };
}

describe("T3-19 item 2: the smoke run stops the watch on a failure", () => {
  it("a failed install after the watch started returns the error, removes the reverse and frees the port", async () => {
    const port = await freePort();
    const { adb, dir, calls } = failingInstallAdb();
    const errors = await runSmoke({ serial: "emulator-5554", adbPath: adb, apk: join(dir, "app.apk"), port, evidence: join(dir, "evidence") });
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/^ERROR tv focus: adb install failed: Failure \[INSTALL_FAILED_TEST\]/);
    const args = calls();
    expect(args.some((a) => a.includes("reverse") && !a.includes("--remove") && a.includes(`tcp:${port}`))).toBe(true);
    const removed = args.findIndex((a) => a.includes("reverse") && a.includes("--remove") && a.includes(`tcp:${port}`));
    expect(removed, JSON.stringify(args)).toBeGreaterThan(args.findIndex((a) => a.includes("install")));
    expect(await canBind(port)).toBe(true);
  });

  it("a port in use rejects before anything is installed", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const address = blocker.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    const { adb, dir, calls } = failingInstallAdb();
    try {
      await expect(runSmoke({ serial: "emulator-5554", adbPath: adb, apk: join(dir, "app.apk"), port })).rejects.toThrow(/Metro/);
      expect(calls().some((a) => a.includes("install"))).toBe(false);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});
