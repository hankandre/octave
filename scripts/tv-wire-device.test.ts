// @vitest-environment node
// T3-26 item 4 (docs/specs/T3-26.md, "Signals"): a run stopped by SIGINT or SIGTERM restores the device's global
// http_proxy and removes its adb reverses. scripts/tv-wire-device.mjs owns that state; the calls are shown with a fake
// adb, first with an injected process object (so the vitest worker's own signals are never hooked) and then with a real
// signal sent to a child process.
//
// Beyond the spec's names, the contract frozen here: openDevice's adb is called with the arguments after the serial, as
// the runner's own adb function is (`shell settings put global http_proxy :0`, `reverse tcp:<device> tcp:<host>`,
// `reverse --remove tcp:<device>`, `shell am force-stop <appId>`).
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHILD = join(repo, "scripts", "fixtures", "tv-wire", "signal-child.mjs");

type Device = {
  setProxy: (devicePort: number) => void;
  clearProxy: () => void;
  reverse: (devicePort: number, hostPort: number) => void;
  reversed: () => number[];
  restore: () => unknown;
};
type DeviceModule = {
  openDevice: (options: { adb: (...args: string[]) => { status: number; stdout: string }; appId: string; proc?: unknown }) => Device;
};

const load = async () => (await import(pathToFileURL(join(repo, "scripts", "tv-wire-device.mjs")).href)) as DeviceModule;

function fakeProc() {
  const exits: number[] = [];
  const proc = Object.assign(new EventEmitter(), {
    exit: (code: number) => {
      exits.push(code);
    },
  });
  return { proc, exits };
}

const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

describe("T3-26 item 4: the device object", () => {
  function open() {
    const calls: string[] = [];
    const adb = (...args: string[]) => {
      calls.push(args.join(" "));
      return { status: 0, stdout: "" };
    };
    const { proc, exits } = fakeProc();
    return load().then(({ openDevice }) => ({ device: openDevice({ adb, appId: "dev.octave.test", proc }), calls, proc, exits }));
  }

  it("T3-26 item 4: no listener is registered until the first reverse or setProxy, and then one per signal", async () => {
    const { device, proc } = await open();
    expect(proc.listenerCount("SIGINT")).toBe(0);
    expect(proc.listenerCount("SIGTERM")).toBe(0);
    device.reverse(47300, 51000);
    expect(proc.listenerCount("SIGINT")).toBe(1);
    expect(proc.listenerCount("SIGTERM")).toBe(1);
    device.reverse(47301, 51001);
    device.setProxy(47401);
    expect(proc.listenerCount("SIGINT")).toBe(1);
    expect(proc.listenerCount("SIGTERM")).toBe(1);
  });

  it("T3-26 item 4: a listener on the first setProxy alone", async () => {
    const { device, proc } = await open();
    device.setProxy(47401);
    expect(proc.listenerCount("SIGINT")).toBe(1);
  });

  it("T3-26 item 4: restore clears the proxy first, removes exactly the reversed ports, never --remove-all, and is safe twice", async () => {
    const { device, calls } = await open();
    device.reverse(47300, 51000);
    device.reverse(47301, 51001);
    device.setProxy(47401);
    expect(device.reversed()).toEqual([47300, 47301]);
    const mark = calls.length;
    await device.restore();
    const after = calls.slice(mark);
    const clear = after.findIndex((call) => call === "shell settings put global http_proxy :0");
    const removes = after.map((call, index) => ({ call, index })).filter(({ call }) => call.startsWith("reverse --remove"));
    expect(clear).toBeGreaterThanOrEqual(0);
    expect(removes.map(({ call }) => call)).toEqual(["reverse --remove tcp:47300", "reverse --remove tcp:47301"]);
    for (const { index } of removes) expect(clear).toBeLessThan(index);
    expect(after.some((call) => call.includes("--remove-all"))).toBe(false);
    expect(after).toContain("shell am force-stop dev.octave.test");
    const again = calls.length;
    await device.restore();
    expect(calls.slice(again).some((call) => call.startsWith("reverse --remove"))).toBe(false);
  });

  it("T3-26 item 4: a SIGINT on the injected process restores and exits 130, a SIGTERM exits 143", async () => {
    for (const [signal, code] of [
      ["SIGINT", 130],
      ["SIGTERM", 143],
    ] as const) {
      const { device, calls, proc, exits } = await open();
      device.reverse(47300, 51000);
      device.setProxy(47401);
      const mark = calls.length;
      proc.emit(signal);
      await tick();
      expect(exits).toEqual([code]);
      expect(calls.slice(mark)).toContain("shell settings put global http_proxy :0");
      expect(calls.slice(mark)).toContain("reverse --remove tcp:47300");
    }
  });
});

describe("T3-26 item 4: a real signal", () => {
  async function stop(signal: "SIGINT" | "SIGTERM") {
    const dir = mkdtempSync(join(tmpdir(), "wire-signal-"));
    const calls = join(dir, "calls.txt");
    writeFileSync(calls, "");
    const child = spawn(process.execPath, [CHILD, calls], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => child.on("exit", (code, sig) => resolve({ code, signal: sig })));
    const ready = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 15_000);
      let text = "";
      child.stdout.on("data", (chunk) => {
        text += String(chunk);
        if (text.includes("ready")) {
          clearTimeout(timer);
          resolve(true);
        }
      });
      void exited.then(() => resolve(false));
    });
    if (!ready) {
      child.kill("SIGKILL");
      throw new Error(`the signal child never printed ready: ${stderr}`);
    }
    const before = readFileSync(calls, "utf8").split("\n").filter(Boolean).length;
    child.kill(signal);
    const result = await Promise.race([exited, tick(15_000).then(() => ({ code: -1, signal: "timeout" }))]);
    if (result.code === -1) child.kill("SIGKILL");
    const after = readFileSync(calls, "utf8").split("\n").filter(Boolean).slice(before);
    return { result, after };
  }

  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const) {
    it(`T3-26 item 4: a real ${signal} exits ${code} after clearing the proxy and removing each reverse`, async () => {
      expect(existsSync(CHILD)).toBe(true);
      const { result, after } = await stop(signal);
      expect(result.code).toBe(code);
      expect(after).toContain("shell settings put global http_proxy :0");
      for (const port of [47300, 47301, 47302]) expect(after.filter((call) => call === `reverse --remove tcp:${port}`)).toHaveLength(1);
      expect(after.some((call) => call.includes("--remove-all"))).toBe(false);
    }, 30_000);
  }
});

describe("T3-26 item 4: the runner reaches the proxy and the reverses only through the device object", () => {
  it("T3-26 item 4: scripts/tv-wire.mjs calls openDevice and holds no http_proxy and no reverse literal", () => {
    const source = readFileSync(join(repo, "scripts", "tv-wire.mjs"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
    expect(code).toMatch(/openDevice\(/);
    expect(code).not.toMatch(/http_proxy/);
    expect(code).not.toMatch(/["']reverse["']/);
  });
});
