// @vitest-environment node
// T3-27 items 1, 3 and 4: each checkout chooses its own three fixture host ports and records them in
// tests/integration/.fixture-ports (docs/specs/T3-27.md). No Docker and no network: isUsable is injected, the setup
// script runs against the fake curl of jellyscale-setup.test.ts, and record files live in temp dirs.
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { choosePorts, fixtureOrigins, readRecord, slotOf, withFixtureOrigins, writeRecord } from "./fixture-ports.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const read = (path: string) => readFileSync(path, "utf8");
const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "octave-ports-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const SERVICES = ["jellyfin-10-11", "jellyfin-12", "jellyscale"] as const;
// slot 0 (0x12c mod 300 = 0) and slot 1 (0x12d mod 300 = 1).
const SLOT_0 = "octave-000000012c";
const SLOT_1 = "octave-000000012d";
const DELETED = "octave-ffffffffff";

// holders maps a port to the Compose project that publishes it; a port is usable for `project` when nobody or
// `project` holds it.
const usableBy = (holders: Map<number, string>) => (port: number, project: string) => {
  const holder = holders.get(port);
  return holder === undefined || holder === project;
};
const heldBy = (project: string, ...ports: number[]) => new Map(ports.map((port) => [port, project]));
const triple = (ports: Record<string, number>) => SERVICES.map((name) => ports[name]);

function ports(result: { ports?: Record<string, number>; error?: string }): number[] {
  expect(result.error, result.error).toBeUndefined();
  return triple(result.ports!);
}

describe("T3-27 item 1: each checkout chooses and records its own ports", () => {
  it("T3-27 item 1: slots come from the project name, three ports per slot from 18096", () => {
    expect(slotOf(SLOT_0)).toBe(0);
    expect(slotOf(SLOT_1)).toBe(1);
    expect(ports(choosePorts({ project: SLOT_0, recorded: null, isUsable: () => true }))).toEqual([18096, 18097, 18098]);
    expect(ports(choosePorts({ project: SLOT_1, recorded: null, isUsable: () => true }))).toEqual([18099, 18100, 18101]);
  });

  it("T3-27 item 1: two projects with different slots get disjoint triples", () => {
    const a = ports(choosePorts({ project: SLOT_0, recorded: null, isUsable: () => true }));
    const b = ports(choosePorts({ project: SLOT_1, recorded: null, isUsable: () => true }));
    expect(a.filter((port) => b.includes(port))).toEqual([]);
  });

  it("T3-27 item 1: with one checkout's triple held by another project, the other moves to the next slot", () => {
    const holders = heldBy(SLOT_0, 18096, 18097, 18098);
    const chosen = ports(choosePorts({ project: SLOT_0, recorded: null, isUsable: usableBy(holders) }));
    expect(chosen).toEqual([18096, 18097, 18098]);
    // A project whose own slot is slot 0 but which is not the holder walks to slot 1.
    const other = ports(choosePorts({ project: "octave-0000000258", recorded: null, isUsable: usableBy(holders) }));
    expect(other).toEqual([18099, 18100, 18101]);
  });

  it("T3-27 item 1: a recorded triple that is free is kept", () => {
    const recorded = { "jellyfin-10-11": 18400, "jellyfin-12": 18401, jellyscale: 18402 };
    expect(ports(choosePorts({ project: SLOT_0, recorded, isUsable: () => true }))).toEqual([18400, 18401, 18402]);
  });

  it("T3-27 item 1: a recorded triple held by this checkout's own project is kept", () => {
    const recorded = { "jellyfin-10-11": 18400, "jellyfin-12": 18401, jellyscale: 18402 };
    const holders = heldBy(SLOT_0, 18400, 18401, 18402);
    expect(ports(choosePorts({ project: SLOT_0, recorded, isUsable: usableBy(holders) }))).toEqual([18400, 18401, 18402]);
  });

  it("T3-27 item 1: writeRecord then readRecord round-trips the three keys", () => {
    const file = join(tempDir(), ".fixture-ports");
    const chosen = { "jellyfin-10-11": 28101, "jellyfin-12": 28102, jellyscale: 28103 };
    writeRecord(chosen, file);
    expect(readRecord(file)).toEqual(chosen);
    const text = read(file);
    expect(text).toContain("OCTAVE_FIXTURE_PORT_JELLYFIN_10_11=28101");
    expect(text).toContain("OCTAVE_FIXTURE_PORT_JELLYFIN_12=28102");
    expect(text).toContain("OCTAVE_FIXTURE_PORT_JELLYSCALE=28103");
  });

  it("T3-27 item 1: no record reads as null, and a partial record is an error naming pnpm fixture:up", () => {
    const dir = tempDir();
    expect(readRecord(join(dir, "missing"))).toBeNull();
    const partial = join(dir, ".fixture-ports");
    writeFileSync(partial, "OCTAVE_FIXTURE_PORT_JELLYFIN_12=28102\n");
    expect(() => readRecord(partial)).toThrow(/pnpm fixture:up/);
    expect(() => readRecord(partial)).toThrow(partial);
  });

  it("T3-27 item 1: with no record, the origins are the defaults 18096-18098", () => {
    expect(fixtureOrigins(join(tempDir(), "missing"))).toEqual({
      "jellyfin-10-11": "http://127.0.0.1:18096",
      "jellyfin-12": "http://127.0.0.1:18097",
      jellyscale: "http://127.0.0.1:18098",
    });
  });

  it("T3-27 item 1: fixtureOrigins reads the record", () => {
    const file = join(tempDir(), ".fixture-ports");
    writeRecord({ "jellyfin-10-11": 28101, "jellyfin-12": 28102, jellyscale: 28103 }, file);
    expect(fixtureOrigins(file)["jellyscale"]).toBe("http://127.0.0.1:28103");
  });

  it("T3-27 item 1: withFixtureOrigins replaces a stale _url and leaves every other key", () => {
    const credentials = {
      jellyscale_url: "http://127.0.0.1:18098",
      jellyscale_password: "p",
      "jellyfin-12_url": "http://127.0.0.1:18097",
      other: "kept",
    };
    const result = withFixtureOrigins(credentials, {
      "jellyfin-10-11": "http://127.0.0.1:28101",
      "jellyfin-12": "http://127.0.0.1:28102",
      jellyscale: "http://127.0.0.1:28103",
    });
    expect(result["jellyscale_url"]).toBe("http://127.0.0.1:28103");
    expect(result["jellyfin-12_url"]).toBe("http://127.0.0.1:28102");
    expect(result["jellyscale_password"]).toBe("p");
    expect(result["other"]).toBe("kept");
    expect(credentials.jellyscale_url).toBe("http://127.0.0.1:18098");
  });

  it("T3-27 item 1: the tripwire, every recorder and the wire runner read the origins through withFixtureOrigins", () => {
    for (const file of ["tests/integration/tripwire.ts", "tests/integration/fixture-recording.mjs", "scripts/tv-wire-fixtures.mjs"]) {
      expect(read(join(repo, file)), file).toContain("withFixtureOrigins");
    }
  });

  it("T3-27 item 1: no reader but the setup script's defaults holds a literal fixture port", () => {
    for (const file of ["tests/integration/tripwire.ts", "tests/integration/fixture-recording.mjs", "scripts/tv-wire-fixtures.mjs", "scripts/tv-wire.mjs"]) {
      expect(read(join(repo, file)), file).not.toMatch(/1809[678]/);
    }
    const lines = read(join(here, "setup-servers.sh")).split("\n").filter((line) => /1809[678]/.test(line));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) expect(line).toMatch(/port_of\s+\S+\s+1809[678]/);
  });

  it("T3-27 item 1: setup-servers.sh reads the record in its own directory", () => {
    const dir = tempDir();
    const bin = join(dir, "bin");
    const work = join(dir, "work");
    mkdirSync(bin);
    mkdirSync(work);
    writeFileSync(
      join(bin, "curl"),
      `#!/usr/bin/env bash
url=""
for arg in "$@"; do case "$arg" in http*) url="$arg" ;; esac; done
echo "$url" >> "$FAKE_LOG"
case "$url" in
  */readyz) exit 0 ;;
  */Users/AuthenticateByName) cat > /dev/null; echo '{"AccessToken":"tok0123456789abcdeftok0123456789ab"}' ;;
  */Items) echo '{"TotalRecordCount":3,"Items":[{"Type":"Movie","Name":"Synthetic H264"},{"Type":"Series","Name":"Synthetic Show"},{"Type":"Episode","Name":"Pilot"}]}' ;;
  *) exit 22 ;;
esac
`,
    );
    writeFileSync(join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(join(bin, "curl"), 0o755);
    chmodSync(join(bin, "sleep"), 0o755);
    copyFileSync(join(here, "setup-servers.sh"), join(work, "setup-servers.sh"));
    writeFileSync(join(work, ".jellyscale.env"), "JELLYSCALE_ADMIN_PASSWORD=0123456789abcdef0123456789abcdef\n", { mode: 0o600 });
    writeFileSync(
      join(work, ".fixture-ports"),
      "OCTAVE_FIXTURE_PORT_JELLYFIN_10_11=28101\nOCTAVE_FIXTURE_PORT_JELLYFIN_12=28102\nOCTAVE_FIXTURE_PORT_JELLYSCALE=28103\n",
    );
    const log = join(dir, "curl.log");
    const result = spawnSync("bash", [join(work, "setup-servers.sh")], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OCTAVE_SETUP_ONLY: "jellyscale", FAKE_LOG: log },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(read(join(work, ".credentials"))).toContain("jellyscale_url=http://127.0.0.1:28103");
    expect(read(log)).toContain("http://127.0.0.1:28103/");
    expect(read(log)).not.toContain(":18098");
  });

  it("T3-27 item 1: fixture-up.sh publishes through the override with the record", () => {
    const script = read(join(here, "fixture-up.sh"));
    const up = script.split("\n").find((line) => /docker compose\b.*\bup -d --wait/.test(line));
    expect(up).toBeDefined();
    expect(up).toContain("docker-compose.ports.yml");
    expect(up).toContain("--env-file");
    expect(up).toContain(".fixture-ports");
    expect(script).not.toContain("--check-ports");
  });

  it("T3-27 item 1: every published line of the override interpolates a required variable of the record, Jellyscale's on loopback", () => {
    const text = read(join(here, "docker-compose.ports.yml"));
    expect((text.match(/ports: !override/g) ?? []).length).toBe(3);
    const published = text.split("\n").filter((line) => /^\s+-\s+"[^"]*:8096"/.test(line));
    expect(published).toHaveLength(3);
    for (const line of published) expect(line).toMatch(/\$\{OCTAVE_FIXTURE_PORT_[A-Z0-9_]+:\?[^}]+\}/);
    expect(text).toMatch(/"127\.0\.0\.1:\$\{OCTAVE_FIXTURE_PORT_JELLYSCALE:\?[^}]+\}:8096"/);
    expect(text).toMatch(/JELLYFIN_PublishedServerUrl: http:\/\/127\.0\.0\.1:\$\{OCTAVE_FIXTURE_PORT_JELLYFIN_10_11:\?/);
    expect(text).toMatch(/JELLYFIN_PublishedServerUrl: http:\/\/127\.0\.0\.1:\$\{OCTAVE_FIXTURE_PORT_JELLYFIN_12:\?/);
  });

  it("T3-27 item 1: the record is gitignored", () => {
    expect(read(join(repo, ".gitignore"))).toContain("tests/integration/.fixture-ports");
  });
});

describe("T3-27 item 3: a project left by a deleted checkout does not block another", () => {
  const recorded = { "jellyfin-10-11": 18096, "jellyfin-12": 18097, jellyscale: 18098 };

  it("T3-27 item 3: a leftover project on 18096-18098 is stepped around with usable ports and no error", () => {
    const isUsable = usableBy(heldBy(DELETED, 18096, 18097, 18098));
    const result = choosePorts({ project: SLOT_0, recorded, isUsable });
    const chosen = ports(result);
    expect(chosen).toHaveLength(3);
    expect(new Set(chosen).size).toBe(3);
    for (const port of chosen) {
      expect([18096, 18097, 18098]).not.toContain(port);
      expect(isUsable(port, SLOT_0)).toBe(true);
    }
  });

  it("T3-27 item 3: one held port moves the whole triple", () => {
    const result = choosePorts({ project: SLOT_0, recorded, isUsable: usableBy(heldBy(DELETED, 18097)) });
    for (const port of ports(result)) expect([18096, 18097, 18098]).not.toContain(port);
  });

  it("T3-27 item 3: with every slot taken it returns a plain error naming the range", () => {
    const result = choosePorts({ project: SLOT_0, recorded, isUsable: () => false });
    expect(result.ports).toBeUndefined();
    expect(result.error).toContain("18096-18995");
  });
});

describe("T3-27 item 4: docs", () => {
  it("T3-27 item 4: docs/commands.md describes the per-checkout ports", () => {
    const text = read(join(repo, "docs", "commands.md"));
    const line = text.split("\n").find((entry) => entry.includes("Fixture servers") && entry.includes("pnpm fixture:up"));
    expect(line).toBeDefined();
    expect(line).toContain(".fixture-ports");
    expect(line).toContain("docker-compose.ports.yml");
    expect(line).toContain("18096");
    expect(text).not.toMatch(/ports are fixed/);
    expect(text).not.toMatch(/only one checkout can have servers up/);
  });
});
