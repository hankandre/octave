// @vitest-environment node
// T3-19 item 2, the start-up half: `pnpm tv:smoke` watches the development server port while the release app starts
// and fails on any connection from the app, and on a missing control connection (a watch that cannot see the device
// proves nothing). Spec, Approach "The development-server watch".
//
// The interface these frozen tests hold (the spec left the adb argument to the test writer; spec check issue 3):
// - startDevServerWatch({ adb, serial, port }) in scripts/tv-dev-server-watch.mjs. `adb` is the path of the adb
//   executable; the watch runs it as `<adb> -s <serial> …` in child processes. It resolves once the listener is bound on
//   127.0.0.1:<port> and `adb -s <serial> reverse tcp:<port> tcp:<port>` has succeeded, to { runControls, result, stop };
//   it rejects when the port is in use, with a message that names Metro or another smoke run.
// - await runControls() runs one control per address the app could use: localhost through the reverse, and 10.0.2.2
//   when the serial starts with `emulator-`. Each control is an `adb -s <serial> shell …` command that names the port
//   (the tests match only `shell` and the port, not the tool, so a TV image without toybox nc may use another). Every
//   connection accepted before runControls() resolves is a control; every one after is the app's.
// - result() is synchronous: { controlsExpected, controlsSeen, appConnections }.
// - await stop() runs `adb -s <serial> reverse --remove tcp:<port>` and closes the listener; it may be called twice and
//   never rejects.
// - judgeDevServerWatch(result) returns `ERROR tv smoke: …` lines; empty only when every control was seen and the app
//   opened no connection.
//
// The fake adb logs each call and exits 0. For a `shell` call that names the port it opens a real connection to
// 127.0.0.1:<port> (the host side of both the reverse and 10.0.2.2), unless it plays a device without the control tool.
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT = 60_000;

type WatchResult = { controlsExpected: number; controlsSeen: number; appConnections: number };
type Watch = { runControls(): Promise<unknown>; result(): WatchResult; stop(): Promise<unknown> };
type WatchModule = {
  startDevServerWatch(options: { adb: string; serial: string; port?: number }): Promise<Watch>;
  judgeDevServerWatch(result: WatchResult): string[];
};

async function load(): Promise<WatchModule> {
  return (await import(pathToFileURL(join(repo, "scripts", "tv-dev-server-watch.mjs")).href)) as WatchModule;
}

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function fakeAdb(mode: "connect" | "no-control", port: number): { adb: string; calls: () => string[][] } {
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
      'const net = require("node:net");',
      "const args = process.argv.slice(2);",
      `appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");`,
      `const mode = ${JSON.stringify(mode)};`,
      `const port = ${port};`,
      'const afterShell = args.slice(args.indexOf("shell") + 1).join(" ");',
      'if (args.includes("shell") && new RegExp("(^|\\\\D)" + port + "(\\\\D|$)").test(afterShell)) {',
      '  if (mode === "no-control") { process.stderr.write("nc: not found\\n"); process.exitCode = 127; }',
      "  else {",
      '    const socket = net.createConnection({ host: "127.0.0.1", port: Number(port) });',
      "    const done = () => { socket.destroy(); };",
      '    socket.on("close", done); socket.on("error", () => { process.exitCode = 1; });',
      "    setTimeout(done, 1000).unref();",
      "  }",
      "}",
      "",
    ].join("\n"),
  );
  chmodSync(adb, 0o755);
  const calls = () =>
    readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
  return { adb, calls };
}

async function connectOnce(port: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const done = () => {
      socket.destroy();
      resolve();
    };
    socket.on("close", done);
    socket.on("error", done);
    setTimeout(done, 1000);
  });
}

async function canBind(port: number): Promise<boolean> {
  const server: Server = createServer();
  const bound = await new Promise<boolean>((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => resolve(true));
  });
  if (bound) await new Promise<void>((resolve) => server.close(() => resolve()));
  return bound;
}

describe("T3-19 item 2: judgeDevServerWatch", () => {
  it("T3-19 item 2: passes when every control was seen and the app opened no connection", async () => {
    const { judgeDevServerWatch } = await load();
    expect(judgeDevServerWatch({ controlsExpected: 2, controlsSeen: 2, appConnections: 0 })).toEqual([]);
    expect(judgeDevServerWatch({ controlsExpected: 1, controlsSeen: 1, appConnections: 0 })).toEqual([]);
  });

  it("T3-19 item 2: fails on one app connection", async () => {
    const { judgeDevServerWatch } = await load();
    const lines = judgeDevServerWatch({ controlsExpected: 2, controlsSeen: 2, appConnections: 1 });
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/^ERROR tv smoke: /);
  });

  it("T3-19 item 2: fails on a missing control connection", async () => {
    const { judgeDevServerWatch } = await load();
    for (const seen of [0, 1]) {
      const lines = judgeDevServerWatch({ controlsExpected: 2, controlsSeen: seen, appConnections: 0 });
      expect(lines.length, `${seen} of 2 controls`).toBeGreaterThan(0);
      for (const line of lines) expect(line).toMatch(/^ERROR tv smoke: /);
    }
  });
});

describe("T3-19 item 2: startDevServerWatch with a fake adb", () => {
  it(
    "T3-19 item 2: on an emulator both controls are seen, a later connection counts as the app's, and stop frees the port and removes the reverse",
    async () => {
      const { startDevServerWatch, judgeDevServerWatch } = await load();
      const port = await freePort();
      const { adb, calls } = fakeAdb("connect", port);
      const serial = "emulator-5554";
      const watch = await startDevServerWatch({ adb, serial, port });
      try {
        const reverse = calls().find((args) => args.includes("reverse") && !args.includes("--remove"));
        expect(reverse, JSON.stringify(calls())).toBeDefined();
        expect(reverse).toContain(serial);
        expect(reverse?.join(" ")).toContain(`tcp:${port}`);

        await watch.runControls();
        const shells = calls().filter((args) => args.includes("shell") && args.slice(args.indexOf("shell") + 1).join(" ").includes(String(port)));
        expect(shells.length, JSON.stringify(calls())).toBe(2);
        for (const args of shells) expect(args).toContain(serial);
        expect(watch.result()).toEqual({ controlsExpected: 2, controlsSeen: 2, appConnections: 0 });
        expect(judgeDevServerWatch(watch.result())).toEqual([]);

        await connectOnce(port);
        await sleep(200);
        expect(watch.result()).toEqual({ controlsExpected: 2, controlsSeen: 2, appConnections: 1 });
        expect(judgeDevServerWatch(watch.result()).length).toBeGreaterThan(0);
      } finally {
        await watch.stop();
      }
      await watch.stop();
      const removed = calls().find((args) => args.includes("reverse") && args.includes("--remove"));
      expect(removed, JSON.stringify(calls())).toBeDefined();
      expect(removed?.join(" ")).toContain(`tcp:${port}`);
      expect(await canBind(port), "stop() frees the port").toBe(true);
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 2: on a device that is not an emulator only the localhost control runs",
    async () => {
      const { startDevServerWatch } = await load();
      const port = await freePort();
      const { adb, calls } = fakeAdb("connect", port);
      const watch = await startDevServerWatch({ adb, serial: "tv-serial-1", port });
      try {
        await watch.runControls();
        expect(calls().filter((args) => args.includes("shell") && args.slice(args.indexOf("shell") + 1).join(" ").includes(String(port))).length).toBe(1);
        expect(watch.result()).toEqual({ controlsExpected: 1, controlsSeen: 1, appConnections: 0 });
      } finally {
        await watch.stop();
      }
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 2: a device whose control cannot connect leaves the control unseen and the judge fails",
    async () => {
      const { startDevServerWatch, judgeDevServerWatch } = await load();
      const port = await freePort();
      const { adb } = fakeAdb("no-control", port);
      const watch = await startDevServerWatch({ adb, serial: "emulator-5556", port });
      try {
        await watch.runControls().catch(() => undefined);
        const result = watch.result();
        expect(result.controlsExpected).toBe(2);
        expect(result.controlsSeen).toBe(0);
        expect(judgeDevServerWatch(result).length).toBeGreaterThan(0);
      } finally {
        await watch.stop();
      }
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 2: a port in use rejects, naming Metro or another smoke run",
    async () => {
      const { startDevServerWatch } = await load();
      const blocker = createServer();
      await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
      const address = blocker.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      const { adb } = fakeAdb("connect", port);
      try {
        await expect(startDevServerWatch({ adb, serial: "emulator-5554", port })).rejects.toThrow(/Metro|smoke/i);
      } finally {
        await new Promise<void>((resolve) => blocker.close(() => resolve()));
      }
    },
    TIMEOUT,
  );
});
