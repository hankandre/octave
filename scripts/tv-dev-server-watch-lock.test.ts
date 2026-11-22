// @vitest-environment node
// T3-30 item 4 (docs/specs/T3-30.md, "Two runs on one host"): the bind of 127.0.0.1:<port> is the host-wide lock, the
// holder writes an owner file, and a second run that cannot bind names the other run and its process id before it
// touches the device. Spec choice: the lock, not telling emulators apart.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { ANDROID_APPLICATION_ID } from "../packages/core/src/domain/app-identity";
import { writeFakeSmokeAdb } from "./fixtures/tv/fake-smoke-adb";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT = 60_000;

type Watch = { runControls(): Promise<string[]>; result(): Record<string, number>; strays(): number; stop(): Promise<unknown> };
type WatchModule = { startDevServerWatch(options: { adb: string; serial: string; port?: number }): Promise<Watch> };
const load = async () => (await import(pathToFileURL(join(repo, "scripts", "tv-dev-server-watch.mjs")).href)) as WatchModule;

const temps: string[] = [];
const ownerFiles: string[] = [];
const servers: Server[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});
afterEach(async () => {
  for (const file of ownerFiles.splice(0)) rmSync(file, { force: true });
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

const ownerFile = (port: number) => {
  const file = join(tmpdir(), `octave-tv-smoke-port-${port}.json`);
  ownerFiles.push(file);
  rmSync(file, { force: true });
  return file;
};

function fake(port: number) {
  const made = writeFakeSmokeAdb({ serial: "emulator-5554", port, appId: ANDROID_APPLICATION_ID, control: "connect" });
  temps.push(made.dir);
  return { adb: made.adb, calls: () => readFileSync(made.log, "utf8").split("\n").filter(Boolean) };
}

async function listener(port: number): Promise<void> {
  const server = createServer((socket) => socket.destroy());
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
}

function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", ""]);
  return child.pid;
}

describe("T3-30 item 4: two smoke runs on one host", () => {
  it("T3-30 item 4: the second run fails at once, names the first run and its process, and never touches the device", async () => {
    const { startDevServerWatch } = await load();
    const port = await freePort();
    ownerFile(port);
    const a = fake(port);
    const b = fake(port);
    const first = await startDevServerWatch({ adb: a.adb, serial: "emulator-5554", port });
    try {
      const before = first.result();
      let message = "";
      try {
        await startDevServerWatch({ adb: b.adb, serial: "emulator-5556", port });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/another pnpm tv:smoke run/);
      expect(message).toContain(String(process.pid));
      expect(message).toContain(String(port));
      expect(message).not.toMatch(/Metro/);
      expect(b.calls()).toEqual([]);
      expect(first.result()).toEqual(before);
      expect(first.strays()).toBe(0);
    } finally {
      await first.stop();
    }
  }, TIMEOUT);

  it("T3-30 item 4: stopping the first run removes the owner file, and the second run can then start", async () => {
    const { startDevServerWatch } = await load();
    const port = await freePort();
    const file = ownerFile(port);
    const first = await startDevServerWatch({ adb: fake(port).adb, serial: "emulator-5554", port });
    expect(existsSync(file)).toBe(true);
    await first.stop();
    expect(existsSync(file)).toBe(false);
    const second = await startDevServerWatch({ adb: fake(port).adb, serial: "emulator-5556", port });
    await second.stop();
  }, TIMEOUT);

  it("T3-30 item 4: a plain listener with no owner file is named as Metro", async () => {
    const { startDevServerWatch } = await load();
    const port = await freePort();
    ownerFile(port);
    await listener(port);
    const b = fake(port);
    await expect(startDevServerWatch({ adb: b.adb, serial: "emulator-5554", port })).rejects.toThrow(/Metro/);
    expect(b.calls()).toEqual([]);
  }, TIMEOUT);

  it("T3-30 item 4: a plain listener with an owner file that names a dead process is named as Metro, not as a smoke run", async () => {
    const { startDevServerWatch } = await load();
    const port = await freePort();
    writeFileSync(ownerFile(port), JSON.stringify({ pid: deadPid() }));
    await listener(port);
    let message = "";
    try {
      await startDevServerWatch({ adb: fake(port).adb, serial: "emulator-5554", port });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/Metro/);
    expect(message).not.toMatch(/another pnpm tv:smoke run/);
  }, TIMEOUT);

  it("T3-30 item 4: an unreadable owner file is the same as none", async () => {
    const { startDevServerWatch } = await load();
    const port = await freePort();
    writeFileSync(ownerFile(port), "not json {");
    await listener(port);
    await expect(startDevServerWatch({ adb: fake(port).adb, serial: "emulator-5554", port })).rejects.toThrow(/Metro/);
  }, TIMEOUT);

  it("T3-30 item 4: a stale owner file for a free port is overwritten, and the new file holds this process id and nothing else", async () => {
    const { startDevServerWatch } = await load();
    const port = await freePort();
    const file = ownerFile(port);
    writeFileSync(file, JSON.stringify({ pid: deadPid() }));
    const watch = await startDevServerWatch({ adb: fake(port).adb, serial: "emulator-5554", port });
    try {
      const owner = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      expect(owner).toEqual({ pid: process.pid });
      expect(readFileSync(file, "utf8")).not.toContain("emulator-5554");
    } finally {
      await watch.stop();
    }
  }, TIMEOUT);

  it("T3-30 item 4: a link left at the owner file's path is not followed, and does not fail the run", async () => {
    const { startDevServerWatch } = await load();
    const port = await freePort();
    const file = ownerFile(port);
    const victimDir = mkdtempSync(join(tmpdir(), "octave-owner-victim-"));
    temps.push(victimDir);
    const victim = join(victimDir, "victim.txt");
    writeFileSync(victim, "keep me");
    symlinkSync(victim, file);
    const watch = await startDevServerWatch({ adb: fake(port).adb, serial: "emulator-5554", port });
    await watch.stop();
    expect(readFileSync(victim, "utf8")).toBe("keep me");
  }, TIMEOUT);
});
