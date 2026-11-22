// @vitest-environment node
// T3-26 review: the interval markers of the log keeper. A tick that never arrives on the stream fails the run with
// the cannot-tell error; the frozen item 3 tests never reach a tick, so this file does.
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
type Kept = { how: string; lines: number; start: boolean; end: boolean; open: boolean; markers: number; missed: number };
type Child = EventEmitter & { stdout: PassThrough; kill: () => void };
type LogcatModule = {
  startLogKeeper: (o: { stream: () => Child; mark: (t: string) => void; nonce: string; waitMs?: number; tickMs?: number }) => Promise<{ finish: () => Promise<Kept> }>;
  logKeptErrors: (kept: Kept) => string[];
};
const load = async () => (await import(pathToFileURL(join(repo, "scripts/tv-wire-logcat.mjs")).href)) as LogcatModule;
const NONCE = "n-tick";

async function run(drop: (text: string) => boolean) {
  const { startLogKeeper, logKeptErrors } = await load();
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), kill() {} }) as Child;
  const mark = (text: string) => {
    if (!drop(text)) child.stdout.write(`01-01 00:00:00.000  1  1 I OctaveWireRun: ${text}\n`);
  };
  const keeper = await startLogKeeper({ stream: () => child, mark, nonce: NONCE, waitMs: 150, tickMs: 20 });
  await new Promise((resolve) => setTimeout(resolve, 130));
  const kept = await keeper.finish();
  return { kept, errors: logKeptErrors(kept) };
}

describe("T3-26 review: interval markers", () => {
  it("every tick arriving is no error", async () => {
    const { kept, errors } = await run(() => false);
    expect(kept.markers).toBeGreaterThan(1);
    expect(kept.missed).toBe(0);
    expect(errors).toEqual([]);
  });

  it("a dropped tick is counted as missed and gives the cannot-tell error", async () => {
    const { kept, errors } = await run((text) => text === `tick ${NONCE} 2`);
    expect(kept.markers).toBeGreaterThan(1);
    expect(kept.missed).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^ERROR tv wire: cannot tell that the run's whole log was kept.*interval marker/);
  });
});
