// The device test's run (T3-02): the core's URL, DeviceId and server-address conformance suites and the host checks, written as
// OCTAVE_E2E lines for scripts/tv-e2e.mjs to judge. No React, React Native or Expo import, so Node runs it too.
// Lines hold fixture text and fixed words only: never a derived DeviceId, an error message or a stack.
import { runDeviceIdConformance } from "@octave/core/src/conformance/device-id-conformance";
import { runServerAddressConformance } from "@octave/core/src/conformance/server-address-conformance";
import { runUrlConformance } from "@octave/core/src/conformance/url-conformance";
import type { Clock } from "@octave/core/src/ports/clock";
import type { Crypto } from "@octave/core/src/ports/crypto";

export interface ConformanceHost {
  clock: Clock;
  crypto: Crypto;
  urlSource: "expo-builtin" | "other";
  engine: "hermes" | "other";
}

type Verdict = "ok" | "bad" | "timeout";

const LIMIT_MS = 2_000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Waits on the runtime's own timer, not the Clock under test.
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function within(ms: number, done: Promise<void>): Promise<boolean> {
  return Promise.race([done.then(() => true), sleep(ms).then(() => false)]);
}

function checkNow(clock: Clock): Verdict {
  const now = clock.now();
  return Number.isInteger(now) && Math.abs(now - Date.now()) < 60_000 ? "ok" : "bad";
}

async function checkAfter(clock: Clock): Promise<Verdict> {
  let runs = 0;
  let cancelledRuns = 0;
  let fired!: () => void;
  const firedOnce = new Promise<void>((resolve) => (fired = resolve));
  clock.after(50, () => {
    runs += 1;
    fired();
  });
  const cancel = clock.after(50, () => (cancelledRuns += 1));
  cancel();
  if (!(await within(LIMIT_MS, firedOnce))) return "timeout";
  await sleep(150);
  return runs === 1 && cancelledRuns === 0 ? "ok" : "bad";
}

async function checkEvery(clock: Clock): Promise<Verdict> {
  let runs = 0;
  let twice!: () => void;
  const ranTwice = new Promise<void>((resolve) => (twice = resolve));
  const cancel = clock.every(20, () => {
    runs += 1;
    if (runs === 2) twice();
  });
  const finished = await within(LIMIT_MS, ranTwice);
  cancel();
  if (!finished) return "timeout";
  const atCancel = runs;
  await sleep(100);
  return runs === atCancel ? "ok" : "bad";
}

export async function runConformance(host: ConformanceHost, log: (line: string) => void): Promise<void> {
  const say = (text: string) => log(`OCTAVE_E2E ${text}`);

  // Each section returns its lines; a throw writes `<name> threw` in place of them, and the run goes on.
  async function section(name: string, run: () => Promise<string[]> | string[]): Promise<void> {
    let lines: string[];
    try {
      lines = await run();
    } catch {
      lines = [`${name} threw`];
    }
    for (const line of lines) say(line);
  }

  say("start conformance");
  say(`host url=${host.urlSource} engine=${host.engine}`);

  await section("url", () => {
    const report = runUrlConformance();
    return [
      ...report.failures.map((failure) => `url-fail file=${failure.file} expected=${failure.expected} actual=${failure.actual} vector=${JSON.stringify(failure.vector)}`),
      `url total=${report.total} passed=${report.passed}`,
    ];
  });

  await section("device-id", async () => {
    const report = await runDeviceIdConformance(host.crypto);
    return [
      ...report.failures.map((failure) => `device-id-fail actual=${failure.actual} vector=${JSON.stringify(failure.vector)}`),
      `device-id total=${report.total} passed=${report.passed}`,
    ];
  });

  await section("server-address", () => {
    const report = runServerAddressConformance();
    return [
      ...report.failures.map((failure) => `server-address-fail list=${failure.list} expected=${failure.expected} actual=${failure.actual} vector=${JSON.stringify(failure.vector)}`),
      `server-address total=${report.total} passed=${report.passed}`,
    ];
  });

  await section("crypto", () => {
    const first = host.crypto.randomId();
    const second = host.crypto.randomId();
    const ok = first !== second && UUID_V4.test(first) && UUID_V4.test(second);
    return [`crypto random-id=${ok ? "ok" : "bad"}`];
  });

  await section("clock", async () => {
    const now = checkNow(host.clock);
    const after = await checkAfter(host.clock);
    const every = await checkEvery(host.clock);
    return [`clock now=${now} after=${after} every=${every}`];
  });

  say("done");
}
