// @vitest-environment node
// T4-05 D10 (Q8): on a device that is positively an emulator, the smoke test clears the app's data after the install and
// before the launch, so a stored sign-in cannot open Home; on any other device it clears nothing. Through a fake adb.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ANDROID_APPLICATION_ID } from "../packages/core/src/domain/app-identity";
import { writeFakeSmokeAdb } from "./fixtures/tv/fake-smoke-adb";
import { runSmoke } from "./tv-first-focus.mjs";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  return typeof address === "object" && address !== null ? address.port : 0;
}

async function calls(emulator: boolean): Promise<string[]> {
  const port = await freePort();
  const fake = writeFakeSmokeAdb({ serial: "emulator-5554", port, appId: ANDROID_APPLICATION_ID, emulator, control: "connect" });
  const evidence = mkdtempSync(join(tmpdir(), "octave-smoke-clear-"));
  dirs.push(fake.dir, evidence);
  const apk = join(fake.dir, "app.apk");
  writeFileSync(apk, "apk");
  await runSmoke({ serial: "emulator-5554", adbPath: fake.adb, apk, port, evidence });
  return readFileSync(fake.log, "utf8").trim().split("\n").filter(Boolean).map((line) => (JSON.parse(line) as string[]).join(" "));
}

describe("T4-05 D10: the smoke test clears a stored sign-in on an emulator only", () => {
  it("clears the app's data after the install and before the launch on an emulator", async () => {
    const seen = await calls(true);
    const install = seen.findIndex((call) => / install -r /.test(` ${call} `));
    const clear = seen.findIndex((call) => call.endsWith(`shell pm clear ${ANDROID_APPLICATION_ID}`));
    const start = seen.findIndex((call) => call.includes("shell am start"));
    expect(install).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(install);
    expect(start).toBeGreaterThan(clear);
    expect(seen.filter((call) => call.includes("pm clear"))).toHaveLength(1);
  }, 120_000);

  it("clears nothing on a device that is not an emulator", async () => {
    const seen = await calls(false);
    expect(seen.filter((call) => call.includes("pm clear"))).toEqual([]);
  }, 120_000);
});
