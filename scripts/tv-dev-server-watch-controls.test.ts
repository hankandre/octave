// @vitest-environment node
// T3-30 item 3 (docs/specs/T3-30.md, "The control window"): the development-server watch counts a control connection
// only while its own controls run, and the run fails whenever a control command fails, so a stray connection cannot
// stand in for a missed control. A connection made before runControls() is called is a stray, counted apart.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { ANDROID_APPLICATION_ID } from "../packages/core/src/domain/app-identity";
import { type FakeSmokeOptions, writeFakeSmokeAdb } from "./fixtures/tv/fake-smoke-adb";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT = 90_000;

type WatchResult = { controlsExpected: number; controlsSeen: number; appConnections: number };
type Watch = { runControls(): Promise<string[]>; result(): WatchResult; strays(): number; stop(): Promise<unknown> };
type WatchModule = {
  startDevServerWatch(options: { adb: string; serial: string; port?: number }): Promise<Watch>;
  judgeDevServerWatch(result: WatchResult, controlFailures?: string[]): string[];
};
type FocusModule = { runSmoke(options: { serial: string; adbPath: string; apk: string; port: number; evidence: string }): Promise<string[]> };

const load = async () => (await import(pathToFileURL(join(repo, "scripts", "tv-dev-server-watch.mjs")).href)) as WatchModule;
const loadFocus = async () => (await import(pathToFileURL(join(repo, "scripts", "tv-first-focus.mjs")).href)) as FocusModule;

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

async function fake(control: FakeSmokeOptions["control"]) {
  const port = await freePort();
  const made = writeFakeSmokeAdb({ serial: "emulator-5554", port, appId: ANDROID_APPLICATION_ID, control });
  temps.push(made.dir);
  return { ...made, port };
}

describe("T3-30 item 3: the control window", () => {
  it("T3-30 item 3: a stray before runControls() is counted apart and cannot stand in for a control that did not connect", async () => {
    const { startDevServerWatch, judgeDevServerWatch } = await load();
    const { adb, port } = await fake("fail-10.0.2.2");
    const watch = await startDevServerWatch({ adb, serial: "emulator-5554", port });
    try {
      await connectOnce(port);
      const failures = await watch.runControls();
      expect(watch.result()).toEqual({ controlsExpected: 2, controlsSeen: 1, appConnections: 0 });
      expect(watch.strays()).toBe(1);
      expect(failures.length).toBe(1);
      expect(judgeDevServerWatch(watch.result(), failures).length).toBeGreaterThan(0);
      expect(judgeDevServerWatch(watch.result()).join("\n")).toMatch(/saw 1 of 2 control connections/);
    } finally {
      await watch.stop();
    }
  }, TIMEOUT);

  it("T3-30 item 3: a failed control beside a stray connection fails the run, though the counts read 2 of 2", async () => {
    const { startDevServerWatch, judgeDevServerWatch } = await load();
    // The 10.0.2.2 control fails after half a second without connecting; the test makes one connection meanwhile.
    const { adb, port } = await fake("slow-fail-10.0.2.2");
    const watch = await startDevServerWatch({ adb, serial: "emulator-5554", port });
    try {
      const running = watch.runControls();
      await sleep(200);
      await connectOnce(port);
      const failures = await running;
      expect(watch.result()).toEqual({ controlsExpected: 2, controlsSeen: 2, appConnections: 0 });
      expect(failures.length).toBe(1);
      const errors = judgeDevServerWatch(watch.result(), failures);
      expect(errors.some((line) => line.startsWith("ERROR tv smoke: ") && line.includes("10.0.2.2")), errors.join("\n")).toBe(true);
    } finally {
      await watch.stop();
    }
  }, TIMEOUT);

  it("T3-30 item 3: a run whose controls all connect and exit 0 has no stray and no error", async () => {
    const { startDevServerWatch, judgeDevServerWatch } = await load();
    const { adb, port } = await fake("connect");
    const watch = await startDevServerWatch({ adb, serial: "emulator-5554", port });
    try {
      const failures = await watch.runControls();
      expect(failures).toEqual([]);
      expect(watch.result()).toEqual({ controlsExpected: 2, controlsSeen: 2, appConnections: 0 });
      expect(watch.strays()).toBe(0);
      expect(judgeDevServerWatch(watch.result(), failures)).toEqual([]);
    } finally {
      await watch.stop();
    }
  }, TIMEOUT);
});

describe("T3-30 item 3: judgeDevServerWatch", () => {
  it("T3-30 item 3: more connections than controls while the controls ran fails, and one argument with 2 of 2 passes", async () => {
    const { judgeDevServerWatch } = await load();
    const errors = judgeDevServerWatch({ controlsExpected: 2, controlsSeen: 3, appConnections: 0 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toMatch(/more connections than controls/);
    for (const line of errors) expect(line.startsWith("ERROR tv smoke: ")).toBe(true);
    expect(judgeDevServerWatch({ controlsExpected: 2, controlsSeen: 2, appConnections: 0 })).toEqual([]);
  });

  it("T3-30 item 3: every control failure is an error line, whether or not the control was seen", async () => {
    const { judgeDevServerWatch } = await load();
    const seen = { controlsExpected: 2, controlsSeen: 2, appConnections: 0 };
    const failures = ["the control to localhost:8081 exited 1: nc failed"];
    expect(judgeDevServerWatch(seen, failures)).toEqual([`ERROR tv smoke: ${failures[0]}`]);
    const two = judgeDevServerWatch(seen, [...failures, "the control to 10.0.2.2:8081 exited 1: nc failed"]);
    expect(two.length).toBe(2);
    expect(judgeDevServerWatch(seen, [])).toEqual([]);
  });
});

describe("T3-30 item 3: the smoke run judges control failures", () => {
  it("T3-30 item 3: a control that connected but exited 1 fails the run and is written to dev-server-watch.txt", async () => {
    const { adb, dir, port } = await fake("connect-then-fail");
    const { runSmoke } = await loadFocus();
    const evidence = join(mkdtempSync(join(tmpdir(), "octave-smoke-evidence-")), "tv");
    temps.push(dirname(evidence));
    const errors = await runSmoke({ serial: "emulator-5554", adbPath: adb, apk: join(dir, "app.apk"), port, evidence });
    expect(errors.some((line) => line.startsWith("ERROR tv smoke: ") && /control to/.test(line)), errors.join("\n")).toBe(true);
    const watchFile = readFileSync(join(evidence, "dev-server-watch.txt"), "utf8");
    expect(watchFile).toMatch(/the control to /);
    expect(watchFile).toMatch(/^port \d+: 2 of 2 control connections seen/);
  }, TIMEOUT);

  it("T3-30 item 3: a clean run writes the first evidence line with the stray count and returns no error", async () => {
    const { adb, dir, port } = await fake("connect");
    const { runSmoke } = await loadFocus();
    const evidence = join(mkdtempSync(join(tmpdir(), "octave-smoke-evidence-")), "tv");
    temps.push(dirname(evidence));
    const errors = await runSmoke({ serial: "emulator-5554", adbPath: adb, apk: join(dir, "app.apk"), port, evidence });
    expect(errors).toEqual([]);
    const first = readFileSync(join(evidence, "dev-server-watch.txt"), "utf8").split("\n")[0];
    expect(first).toBe(`port ${port}: 2 of 2 control connections seen, 0 app connections, 0 connections before the controls (not counted)`);
  }, TIMEOUT);
});
