// @vitest-environment node
// T3-26 item 3 (docs/specs/T3-26.md, "The kept log"): the run's log is kept by streaming, so early lines cannot rotate
// out, and the run fails when it cannot show the stream covered it. The stream is faked here: a PassThrough for stdout
// and an emitter for exit, and a `mark` that writes the marker line into the stream as logd would echo it.
//
// Beyond the spec's names, the contract frozen here: startLogKeeper's lines() returns the stream's lines (no trailing
// newline) and still can after finish(); finish() resolves to { how: "stream", lines, start, end, open }; the keeper
// matches its markers as the text `start <nonce>` and `end <nonce>` inside a line.
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = async <T>(path: string) => (await import(pathToFileURL(join(repo, path)).href)) as T;

type Kept = { how: string; lines: number; start: boolean; end: boolean; open: boolean };
type Child = EventEmitter & { stdout: PassThrough; kill: () => void; killed: boolean };
type Keeper = { lines: () => string[]; finish: () => Promise<Kept>; stop: () => void };
type LogcatModule = {
  startLogKeeper: (options: { stream: () => Child; mark: (text: string) => void; nonce: string; waitMs?: number }) => Promise<Keeper>;
  logKeptErrors: (kept: Kept) => string[];
  describeLogKept: (kept: Kept) => string;
};
type JudgeModule = { judgeLogcat: (lines: string[], secrets: string[]) => string[] };

const NONCE = "n-1234";
const SECRET = "tok-secret-0a1b2c3d4e5f";
const line = (text: string) => `01-01 00:00:00.000  1  1 I OctaveWireRun: ${text}`;

function fakeStream() {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), killed: false, kill() { this.killed = true; } }) as Child;
  return child;
}

function setup(drop: (text: string) => boolean = () => false) {
  const child = fakeStream();
  const mark = (text: string) => {
    if (!drop(text)) child.stdout.write(`${line(text)}\n`);
  };
  return { child, options: { stream: () => child, mark, nonce: NONCE, waitMs: 150 } };
}

describe("T3-26 item 3: the log keeper", () => {
  it("T3-26 item 3: a secret line sent first is still held after many more lines, and judgeLogcat fails it", async () => {
    const { startLogKeeper } = await load<LogcatModule>("scripts/tv-wire-logcat.mjs");
    const { judgeLogcat } = await load<JudgeModule>("scripts/tv-wire-judge.mjs");
    const { child, options } = setup();
    const keeper = await startLogKeeper(options);
    child.stdout.write(`${line(`leaked ${SECRET}`)}\n`);
    for (let index = 0; index < 20_000; index += 1) child.stdout.write(`${line(`filler ${index}`)}\n`);
    await keeper.finish();
    const lines = keeper.lines();
    expect(lines.some((text) => text.includes(SECRET))).toBe(true);
    expect(lines.length).toBeGreaterThan(20_000);
    expect(judgeLogcat(lines, [SECRET]).length).toBeGreaterThan(0);
  });

  it("T3-26 item 3: a line split across two chunks is one line", async () => {
    const { startLogKeeper } = await load<LogcatModule>("scripts/tv-wire-logcat.mjs");
    const { child, options } = setup();
    const keeper = await startLogKeeper(options);
    child.stdout.write("01-01 00:00:00.000  1  1 I Tag: abc");
    child.stdout.write("def ghi\n");
    await keeper.finish();
    const lines = keeper.lines();
    expect(lines.filter((text) => text.includes("abcdef ghi"))).toHaveLength(1);
    expect(lines.some((text) => text.endsWith("abc"))).toBe(false);
  });

  it("T3-26 item 3: a whole run shows both markers and an open stream, and logKeptErrors is empty", async () => {
    const { startLogKeeper, logKeptErrors } = await load<LogcatModule>("scripts/tv-wire-logcat.mjs");
    const { child, options } = setup();
    const keeper = await startLogKeeper(options);
    child.stdout.write(`${line("something")}\n`);
    const kept = await keeper.finish();
    expect(kept).toMatchObject({ how: "stream", start: true, end: true, open: true });
    expect(kept.lines).toBeGreaterThan(0);
    expect(logKeptErrors(kept)).toEqual([]);
    expect(child.killed).toBe(true);
  });

  it("T3-26 item 3: a missing start marker gives a cannot-tell error", async () => {
    const { startLogKeeper, logKeptErrors } = await load<LogcatModule>("scripts/tv-wire-logcat.mjs");
    const { child, options } = setup((text) => text.startsWith("start"));
    const keeper = await startLogKeeper(options);
    child.stdout.write(`${line("something")}\n`);
    const kept = await keeper.finish();
    expect(kept.start).toBe(false);
    const errors = logKeptErrors(kept);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^ERROR tv wire: cannot tell that the run's whole log was kept/);
  });

  it("T3-26 item 3: a missing end marker gives a cannot-tell error", async () => {
    const { startLogKeeper, logKeptErrors } = await load<LogcatModule>("scripts/tv-wire-logcat.mjs");
    const { child, options } = setup((text) => text.startsWith("end"));
    const keeper = await startLogKeeper(options);
    child.stdout.write(`${line("something")}\n`);
    const kept = await keeper.finish();
    expect(kept.end).toBe(false);
    expect(logKeptErrors(kept)[0]).toMatch(/cannot tell/);
  });

  it("T3-26 item 3: a stream that exited before finish gives a cannot-tell error", async () => {
    const { startLogKeeper, logKeptErrors } = await load<LogcatModule>("scripts/tv-wire-logcat.mjs");
    const { child, options } = setup();
    const keeper = await startLogKeeper(options);
    child.stdout.write(`${line("something")}\n`);
    child.emit("exit", 1, null);
    const kept = await keeper.finish();
    expect(kept.open).toBe(false);
    expect(logKeptErrors(kept)[0]).toMatch(/cannot tell/);
  });

  it("T3-26 item 3: zero lines gives a cannot-tell error", async () => {
    const { logKeptErrors } = await load<LogcatModule>("scripts/tv-wire-logcat.mjs");
    expect(logKeptErrors({ how: "stream", lines: 0, start: true, end: true, open: true })[0]).toMatch(/cannot tell/);
    expect(logKeptErrors({ how: "stream", lines: 3, start: true, end: true, open: true })).toEqual([]);
  });

  it("T3-26 item 3: describeLogKept says streaming and the line count", async () => {
    const { describeLogKept } = await load<LogcatModule>("scripts/tv-wire-logcat.mjs");
    const text = describeLogKept({ how: "stream", lines: 5210, start: true, end: true, open: true });
    expect(text).toMatch(/stream/i);
    expect(text).toContain("5210");
  });

  it("T3-26 item 3: scripts/tv-wire.mjs imports startLogKeeper and logKeptErrors", () => {
    const source = readFileSync(join(repo, "scripts", "tv-wire.mjs"), "utf8");
    expect(source).toMatch(/import\s*\{[^}]*startLogKeeper[^}]*\}\s*from\s*"\.\/tv-wire-logcat\.mjs"/);
    expect(source).toMatch(/logKeptErrors/);
  });
});

describe("T3-26 item 3: the run's judging uses the kept log", () => {
  type Rec = Record<string, unknown>;
  const rec = (path: string, method: string, token: boolean): Rec => ({
    method,
    path,
    queryNames: [],
    authorization: true,
    scheme: "MediaBrowser",
    token,
    host: "127.0.0.1:47300",
    status: 200,
    retryAfter: null,
    secretInUrl: false,
  });
  const records = [
    rec("/System/Info/Public", "GET", false),
    rec("/Users/AuthenticateByName", "POST", false),
    rec("/UserViews", "GET", true),
    rec("/Sessions/Logout", "POST", true),
  ];
  const input = (kept: Kept) => ({
    pairs: [{ test: "transport-probe-then-signed-in", target: "mock", task: "T3-05", devicePort: 47300, records }],
    counts: { canaryOrigin: 0, redirector: 0, privateLan: 0 },
    lines: ["OCTAVE_WIRE result test=transport-probe-then-signed-in target=mock task=T3-05 outcome=ok", "OCTAVE_WIRE done"],
    logLines: ["01-01 00:00:00.000  1  1 I ReactNativeJS: fine"],
    seen: [],
    devicePorts: [47300],
    secrets: ["tok-x"],
    voids: [],
    kept,
    deviceLines: ["adbd up 90 s before the reverses"],
  });
  type Run = (input: unknown, deps: { write: (evidence: { deviceLines: string[] }) => string[] }) => { summary: string[]; errors: string[]; failed: boolean };

  it("T3-26 item 3: the kept-log line reaches the deviceLines handed to the evidence writer", async () => {
    const { judgeRun } = await load<{ judgeRun: Run }>("scripts/tv-wire.mjs");
    const { describeLogKept } = await load<LogcatModule>("scripts/tv-wire-logcat.mjs");
    const kept: Kept = { how: "stream", lines: 5210, start: true, end: true, open: true };
    let device: string[] = [];
    const result = judgeRun(input(kept), {
      write: (evidence) => {
        device = evidence.deviceLines;
        return [];
      },
    });
    expect(device).toContain(describeLogKept(kept));
    expect(device.some((text) => text.includes("5210"))).toBe(true);
    expect(result.failed, result.errors.join("\n")).toBe(false);
  });

  it("T3-26 item 3: a log that cannot be shown whole fails every pair with the cannot-tell error", async () => {
    const { judgeRun } = await load<{ judgeRun: Run }>("scripts/tv-wire.mjs");
    const result = judgeRun(input({ how: "stream", lines: 5210, start: true, end: false, open: true }), { write: () => [] });
    expect(result.summary).toEqual(["transport-probe-then-signed-in mock T3-05 fail"]);
    expect(result.errors.some((error) => /cannot tell that the run's whole log was kept/.test(error))).toBe(true);
    expect(result.failed).toBe(true);
  });
});
