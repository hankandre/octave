// @vitest-environment node
// T3-26 item 2 (docs/specs/T3-26.md, "Removing old evidence"): `pnpm tv:wire` removes release-evidence/wire before its
// first possible exit, so a run that fails early leaves no summary.txt from an earlier run. Each case runs the real CLI
// with OCTAVE_WIRE_EVIDENCE naming a temporary directory that holds a planted all-pass summary.txt. The child's
// environment is built here and holds no ANDROID_SERIAL, so no case can reach a device, a fixture step or a build.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER = join(repo, "scripts", "tv-wire.mjs");

function plant(): { dir: string; summary: string; env: NodeJS.ProcessEnv } {
  const root = mkdtempSync(join(tmpdir(), "wire-cli-"));
  const dir = join(root, "release-evidence", "wire");
  mkdirSync(dir, { recursive: true });
  const summary = join(dir, "summary.txt");
  writeFileSync(summary, "transport-probe-then-signed-in mock T3-05 pass\n");
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: root, OCTAVE_WIRE_EVIDENCE: dir };
  return { dir, summary, env };
}

function run(script: string, args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [script, ...args], { cwd: repo, env, encoding: "utf8", timeout: 60_000 });
}

describe("T3-26 item 2: the evidence is removed before any exit", () => {
  it("T3-26 item 2: no ANDROID_SERIAL exits 1 and the planted summary is gone", () => {
    const { summary, env } = plant();
    const child = run(RUNNER, [], env);
    expect(child.status, child.stderr).toBe(1);
    expect(existsSync(summary)).toBe(false);
  });

  it("T3-26 item 2: an unknown argument exits 1 and the planted summary is gone", () => {
    const { summary, env } = plant();
    const child = run(RUNNER, ["--nope"], env);
    expect(child.status, child.stderr).toBe(1);
    expect(existsSync(summary)).toBe(false);
  });

  it("T3-26 item 2: a task no test carries exits 1 and the planted summary is gone", () => {
    const { summary, env } = plant();
    const child = run(RUNNER, ["--task", "T0-00"], env);
    expect(child.status, child.stderr).toBe(1);
    expect(existsSync(summary)).toBe(false);
  });

  it("T3-26 item 2: --list prints the pairs, exits 0 and removes the planted summary", () => {
    const { summary, env } = plant();
    const child = run(RUNNER, ["--list"], env);
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toContain("transport-probe-then-signed-in mock T3-05");
    expect(existsSync(summary)).toBe(false);
  });

  it("T3-26 item 2: --list through a symlink to the repository still runs main and removes the planted summary", () => {
    const { summary, env } = plant();
    const linkRoot = mkdtempSync(join(tmpdir(), "wire-link-"));
    const link = join(linkRoot, "repo");
    symlinkSync(repo, link);
    const child = run(join(link, "scripts", "tv-wire.mjs"), ["--list"], env);
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toContain("transport-probe-then-signed-in mock T3-05");
    expect(existsSync(summary)).toBe(false);
  });
});

describe("T3-26 item 2: evidenceDir and clearEvidence", () => {
  const load = async () =>
    (await import(pathToFileURL(join(repo, "scripts", "tv-wire-evidence.mjs")).href)) as {
      evidenceDir: (env?: NodeJS.ProcessEnv) => string;
      clearEvidence: (dir: string) => void;
    };

  it("T3-26 item 2: evidenceDir is the checkout's release-evidence/wire by default and the override when it is valid", async () => {
    const { evidenceDir } = await load();
    expect(evidenceDir({})).toBe(join(repo, "release-evidence", "wire"));
    const valid = join(tmpdir(), "somewhere", "release-evidence", "wire");
    expect(evidenceDir({ OCTAVE_WIRE_EVIDENCE: valid })).toBe(valid);
  });

  it("T3-26 item 2: evidenceDir throws for a relative override and for one that does not end in release-evidence/wire", async () => {
    const { evidenceDir } = await load();
    expect(() => evidenceDir({ OCTAVE_WIRE_EVIDENCE: "release-evidence/wire" })).toThrow();
    expect(() => evidenceDir({ OCTAVE_WIRE_EVIDENCE: join(tmpdir(), "elsewhere") })).toThrow();
    expect(() => evidenceDir({ OCTAVE_WIRE_EVIDENCE: join(tmpdir(), "release-evidence", "wire-other") })).toThrow();
    expect(() => evidenceDir({ OCTAVE_WIRE_EVIDENCE: "/" })).toThrow();
  });

  it("T3-26 item 2: clearEvidence removes the directory and a second call is safe", async () => {
    const { clearEvidence } = await load();
    const { dir, summary } = plant();
    clearEvidence(dir);
    expect(existsSync(summary)).toBe(false);
    expect(existsSync(dir)).toBe(false);
    expect(() => clearEvidence(dir)).not.toThrow();
  });
});
