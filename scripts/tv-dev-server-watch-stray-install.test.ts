// @vitest-environment node
// T3-30 review follow-up: a connection made while the caller blocks the event loop (a synchronous adb install) is a
// stray, not a control.
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { ANDROID_APPLICATION_ID } from "../packages/core/src/domain/app-identity";
import { writeFakeSmokeAdb } from "./fixtures/tv/fake-smoke-adb";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe("T3-30: a connection during a blocking call", () => {
  it("is a stray and not a control", async () => {
    const { startDevServerWatch } = (await import(pathToFileURL(join(repo, "scripts", "tv-dev-server-watch.mjs")).href)) as {
      startDevServerWatch(o: { adb: string; serial: string; port: number }): Promise<{ runControls(): Promise<string[]>; result(): { controlsSeen: number }; strays(): number; stop(): Promise<unknown> }>;
    };
    const port = await freePort();
    const made = writeFakeSmokeAdb({ serial: "emulator-5554", port, appId: ANDROID_APPLICATION_ID, control: "connect" });
    const watch = await startDevServerWatch({ adb: made.adb, serial: "emulator-5554", port });
    try {
      const child = spawn(process.execPath, ["-e", `require("net").connect(${port},"127.0.0.1",()=>setTimeout(()=>process.exit(0),1500))`], { stdio: "ignore" });
      // Block the event loop while the child connects, as a synchronous adb install does.
      spawnSync(process.execPath, ["-e", "setTimeout(()=>{},400)"]);
      const failures = await watch.runControls();
      child.kill();
      expect(failures).toEqual([]);
      expect(watch.strays()).toBe(1);
      expect(watch.result().controlsSeen).toBe(2);
    } finally {
      await watch.stop();
      rmSync(made.dir, { recursive: true, force: true });
    }
  }, 60_000);
});
