// @vitest-environment node
// T3-05 acceptance item 8: each checkout gets its own Compose project name for the fixture servers, so two
// worktrees' runs neither adopt, recreate nor stop each other's containers (docs/specs/T3-05.md, "Compose projects";
// the reading of "collide" is the spec's: the host ports stay fixed, and a second checkout stops and names the holder).
//
// The contract frozen here, in tests/integration/compose-project.mjs:
// - composeProjectName(root): "octave-" and the first 10 hex characters of the SHA-256 of the checkout's real path.
// - composeArgs(): ["-p", <this checkout's name>, "-f", <its tests/integration/docker-compose.yml>].
// - Run as a script, it prints this checkout's name, wherever it is run from.
// - judgePortHolders(holders, ours): holders are [{ port, project }] (project null when the port is free); returns
//   `ERROR ...` lines, empty when every port is free or held by ours, and for another project a line naming it and
//   the command that removes it, `docker compose -p <name> down -v`.
// Every Compose call in the fixture scripts, the tripwire, package.json and CI passes the project argument.
//
// The module is loaded at run time from a path built here, so `pnpm typecheck` does not depend on it existing.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");

type Holder = { port: number; project: string | null };
type ComposeProject = {
  composeProjectName: (root: string) => string;
  composeArgs: () => string[];
  judgePortHolders: (holders: Holder[], ours: string) => string[];
};

async function loadProject(): Promise<ComposeProject> {
  return (await import(pathToFileURL(join(repo, "tests/integration/compose-project.mjs")).href)) as ComposeProject;
}

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "octave-compose-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const PORTS = [18096, 18097, 18098];
const NAME = /^[a-z0-9][a-z0-9_-]*$/;

function expected(root: string): string {
  return `octave-${createHash("sha256").update(realpathSync(root)).digest("hex").slice(0, 10)}`;
}

// The text of each `docker compose` command line in a shell or YAML file, and the args array of each "compose" call
// in a TypeScript file.
function shellComposeLines(text: string): string[] {
  return text.split("\n").filter((line) => /\bdocker\s+compose\b/.test(line) && !/^\s*#/.test(line));
}

function tsComposeCalls(text: string): string[] {
  const calls: string[] = [];
  for (const match of text.matchAll(/["'`]compose["'`]/g)) {
    const end = text.indexOf("]", match.index);
    calls.push(text.slice(match.index, end === -1 ? undefined : end));
  }
  return calls;
}

describe("T3-05 item 8: each checkout gets its own Compose project name", () => {
  it("derives octave-<10 hex of the SHA-256 of the real path>, a valid Compose name", async () => {
    const { composeProjectName } = await loadProject();
    const root = tempDir();
    const name = composeProjectName(root);
    expect(name).toBe(expected(root));
    expect(name).toMatch(/^octave-[0-9a-f]{10}$/);
    expect(name).toMatch(NAME);
  });

  it("gives two checkouts two names, and one checkout the same name twice, also through a symlink", async () => {
    const { composeProjectName } = await loadProject();
    const first = tempDir();
    const second = tempDir();
    expect(composeProjectName(first)).not.toBe(composeProjectName(second));
    expect(composeProjectName(first)).toBe(composeProjectName(first));
    const links = tempDir();
    const link = join(links, "checkout-link");
    symlinkSync(first, link);
    expect(composeProjectName(link)).toBe(composeProjectName(first));
  });

  it("builds the Compose arguments for this checkout", async () => {
    const { composeArgs, composeProjectName } = await loadProject();
    const args = composeArgs();
    expect(args).toHaveLength(4);
    expect(args[0]).toBe("-p");
    expect(args[1]).toBe(composeProjectName(repo));
    expect(args[1]).not.toBe("integration");
    expect(args[2]).toBe("-f");
    expect(args[3].replace(/\\/g, "/")).toMatch(/(^|\/)tests\/integration\/docker-compose\.yml$/);
    const file = isAbsolute(args[3]) ? args[3] : resolve(repo, args[3]);
    expect(realpathSync(file)).toBe(realpathSync(join(here, "docker-compose.yml")));
  });

  it("prints this checkout's name when run, from any working directory", async () => {
    const { composeProjectName } = await loadProject();
    for (const cwd of [repo, tempDir()]) {
      const out = spawnSync(process.execPath, [join(repo, "tests/integration/compose-project.mjs")], { cwd, encoding: "utf8" });
      expect(out.status, out.stderr).toBe(0);
      expect(out.stdout.trim()).toBe(composeProjectName(repo));
    }
  });

  it("passes the project argument in every Compose call of the fixture scripts and CI", () => {
    for (const path of ["tests/integration/fixture-up.sh", "tests/integration/fixture-down.sh"]) {
      expect(existsSync(join(repo, path)), path).toBe(true);
      const text = read(path);
      expect(text, path).toContain("compose-project.mjs");
      const lines = shellComposeLines(text);
      expect(lines.length, path).toBeGreaterThan(0);
      for (const line of lines) expect(line, path).toMatch(/\bdocker\s+compose\s+(?:[^\n]*\s)?-p\s+\S/);
      expect(text, path).not.toMatch(/\bdocker-compose\s/);
    }
    expect(shellComposeLines(read("tests/integration/fixture-up.sh")).some((line) => /up -d --wait/.test(line))).toBe(true);
    expect(shellComposeLines(read("tests/integration/fixture-down.sh")).some((line) => /\bdown -v\b/.test(line))).toBe(true);

    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("pnpm fixture:up");
    for (const line of shellComposeLines(ci)) expect(line, "ci.yml").toMatch(/\bdocker\s+compose\s+(?:[^\n]*\s)?-p\s+\S/);
    expect(ci).not.toMatch(/\bdocker-compose\s/);
  });

  it("passes the project argument in every Compose call of the tripwire", () => {
    for (const path of ["tests/integration/tripwire-container.ts", "tests/integration/tripwire-jellyscale.ts"]) {
      const calls = tsComposeCalls(read(path));
      expect(calls.length, path).toBeGreaterThan(0);
      for (const call of calls) expect(call, path).toMatch(/composeArgs\s*\(|["'`]-p["'`]/);
    }
  });

  it("makes pnpm fixture:down stop this checkout's project only", () => {
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
    expect(scripts["fixture:down"]).toBe("bash tests/integration/fixture-down.sh");
    for (const [name, command] of Object.entries(scripts)) {
      for (const line of shellComposeLines(command)) expect(line, name).toMatch(/\bdocker\s+compose\s+(?:[^\n]*\s)?-p\s+\S/);
    }
  });

  it("judgePortHolders passes free ports and ports held by this checkout's project", async () => {
    const { judgePortHolders } = await loadProject();
    const ours = "octave-0a1b2c3d4e";
    expect(judgePortHolders(PORTS.map((port) => ({ port, project: null })), ours)).toEqual([]);
    expect(judgePortHolders(PORTS.map((port) => ({ port, project: ours })), ours)).toEqual([]);
    expect(judgePortHolders([{ port: 18096, project: ours }, { port: 18097, project: null }, { port: 18098, project: ours }], ours)).toEqual([]);
    expect(judgePortHolders([], ours)).toEqual([]);
  });

  it("judgePortHolders fails another project's ports, naming it and the command that removes it", async () => {
    const { judgePortHolders } = await loadProject();
    const ours = "octave-0a1b2c3d4e";
    const legacy = judgePortHolders(
      [
        { port: 18096, project: "integration" },
        { port: 18097, project: "integration" },
        { port: 18098, project: null },
      ],
      ours,
    );
    expect(legacy.length).toBeGreaterThan(0);
    expect(legacy.join("\n")).toContain("integration");
    expect(legacy.join("\n")).toContain("docker compose -p integration down -v");

    const two = judgePortHolders(
      [
        { port: 18096, project: ours },
        { port: 18097, project: "octave-ffffffffff" },
        { port: 18098, project: "octave-1234567890" },
      ],
      ours,
    ).join("\n");
    expect(two).toContain("docker compose -p octave-ffffffffff down -v");
    expect(two).toContain("docker compose -p octave-1234567890 down -v");
    expect(two).not.toContain(`docker compose -p ${ours} down`);
  });
});
