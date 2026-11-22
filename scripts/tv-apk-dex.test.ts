// @vitest-environment node
// T3-19 items 1, 2 (the dex half), 4 and 5: `pnpm tv:apk:check` reads the release APK's dex through R8's mapping and
// fails when Octave's code holds a network sink outside the one client or references a listed entry point, when a
// class outside APK_NETWORK_ENTRY_POINTS holds a sink, when a row is stale, when the input is not whole, and when a
// class outside DEV_SUPPORT_CLIENT_CALLERS references DevSupportHttpClient.
//
// The fixtures are excerpts of a real release build (scripts/fixtures/tv/dex/release-*.txt, headers name the build)
// plus hand-written class blocks (scripts/fixtures/tv/dex/extra/). They are judged with the test-owned lists in
// scripts/fixtures/tv/dex/lists.mjs; the production lists are checked here only for their shape. The interface the
// tests hold is written at the top of scripts/fixtures/tv/dex/harness.ts.
//
// Spec check issue 1: an Octave class that sends through OctaveHttp.callFactory(session) invokes okhttp3.Call$Factory;
// that sample must pass. Spec check issue 2: an instruction of a class whose class line names a dev.octave. class, and
// that resolves to no frame, is not skipped.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  cleanTemps,
  composeDump,
  composeMapping,
  dexBytes,
  loadFixtureLists,
  loadProductionLists,
  PG_MAP_ID,
  r8Marker,
  repo,
  runDex,
  type DexRun,
  type Lists,
} from "./fixtures/tv/dex/harness";

const TIMEOUT = 60_000;

afterAll(() => cleanTemps());

type EntryPoint = { id: string; classes: string[]; sinks: string[]; what: string; reason: string; linkedPath: string | null };
type LinkedEntry = { id: string; package: string; reason: string };

async function linkedNetworkPaths(): Promise<LinkedEntry[]> {
  const module = (await import(pathToFileURL(join(repo, "scripts", "linked-network-paths.mjs")).href)) as { LINKED_NETWORK_PATHS: LinkedEntry[] };
  return module.LINKED_NETWORK_PATHS;
}

async function fixtureLists(change: (lists: Lists) => Lists = (lists) => lists): Promise<Lists> {
  const { FIXTURE_LISTS } = await loadFixtureLists();
  return change({ ...FIXTURE_LISTS });
}

const plain = (text: string) => text.replace(/`/g, "").replace(/\s+/g, " ").trim();
const errors = (run: DexRun) => run.out.split("\n").filter((line) => line.startsWith("ERROR tv apk dex:"));

function expectPass(run: DexRun): void {
  expect(errors(run), run.out).toEqual([]);
  expect(run.code, run.out).toBe(0);
  expect(run.out).toMatch(/^tv apk dex: .* passes/m);
}

function expectFail(run: DexRun, ...names: (string | RegExp)[]): void {
  expect(run.code, run.out).toBe(1);
  expect(errors(run).length, run.out).toBeGreaterThan(0);
  for (const name of names) {
    if (typeof name === "string") expect(run.out, run.out).toContain(name);
    else expect(run.out, run.out).toMatch(name);
  }
}

// --- item 1 ---------------------------------------------------------------------------------------------------

describe("T3-19 item 1: the dex check on the release excerpt", () => {
  it(
    "T3-19 item 1: the release excerpt passes, read through dexdump -d on the APK",
    async () => {
      const run = await runDex();
      expectPass(run);
      expect(run.dexdumpArgs, "the fake dexdump was run").not.toBeNull();
      expect(run.dexdumpArgs).toContain("-d");
      expect(run.dexdumpArgs?.some((arg) => arg.endsWith("app-release.apk"))).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 1: a stored (not deflated) classes.dex passes too",
    async () => {
      const run = await runDex({ apkEntries: [{ name: "classes.dex", data: dexBytes() }] });
      expectPass(run);
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 1: an Octave class that opens nothing and references no listed class passes (the control for the probes)",
    async () => {
      const run = await runDex({ dump: composeDump(["probe-benign"]), mapping: composeMapping(["probe"]) });
      expectPass(run);
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 1: D4 fails when an Octave method calls React Native's NetworkingModule, and names both ends",
    async () => {
      const run = await runDex({ dump: composeDump(["probe-calls-networking"]), mapping: composeMapping(["probe"]) });
      expectFail(run, "dev.octave.tv.Probe", "com.facebook.react.modules.network.NetworkingModule");
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 1: D1 fails when an Octave method outside the one client opens a URL connection, and says to send through OctaveHttp.callFactory",
    async () => {
      const run = await runDex({ dump: composeDump(["probe-opens-url"]), mapping: composeMapping(["probe"]) });
      expectFail(run, "dev.octave.tv.Probe", "OctaveHttp.callFactory");
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 1: an Octave instruction that resolves to no frame is not skipped (the NetworkingModule call in pq9, whose class line is dev.octave.tv.Probe)",
    async () => {
      const run = await runDex({ dump: composeDump(["probe-unresolved"]), mapping: composeMapping(["probe-unresolved"]) });
      expectFail(run, /pq9|dev\.octave\.tv\.Probe/);
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 1: an Octave class that sends through OctaveHttp.callFactory(session).newCall(request) passes",
    async () => {
      const run = await runDex({ dump: composeDump(["sender-one-client"]), mapping: composeMapping(["sender-one-client"]) });
      expectPass(run);
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 1: D2 fails when a class on no list builds an OkHttpClient",
    async () => {
      const run = await runDex({ dump: composeDump(["sneak-unlisted-client"]), mapping: composeMapping(["sneak-unlisted-client"]) });
      expectFail(run, "com.example.Sneak");
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 1: D2 attributes by member line, not class line: Sneak's code merged into a class whose class line a row covers still fails",
    async () => {
      const run = await runDex({ dump: composeDump(["merged-sneak"]), mapping: composeMapping(["merged-sneak"]) });
      expectFail(run, "com.example.Sneak");
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 1: D2 fails when a sink's kind is not among its row's sinks",
    async () => {
      const lists = await fixtureLists((base) => ({
        ...base,
        entryPoints: (base.entryPoints as EntryPoint[]).map((row) =>
          row.classes.includes("expo.modules.filesystem.FileSystemDownloadKt") ? { ...row, sinks: ["S5"] } : row,
        ),
      }));
      const run = await runDex({ lists });
      expectFail(run, "expo.modules.filesystem.FileSystemDownloadKt");
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 1: D3 fails on a row that no sink in the APK matches",
    async () => {
      const lists = await fixtureLists((base) => ({
        ...base,
        entryPoints: [
          ...(base.entryPoints as EntryPoint[]),
          {
            id: "FX9",
            classes: ["com.facebook.react.modules.websocket.WebSocketModule"],
            sinks: ["S1"],
            what: "a row the excerpt does not hold",
            reason: "Fixture row.",
            linkedPath: null,
          },
        ],
      }));
      const run = await runDex({ lists });
      expectFail(run, /FX9|com\.facebook\.react\.modules\.websocket\.WebSocketModule/);
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 1: D4 resolves a reference by member, not by class line (w63.m0 is androidx.tracing code merged into UtilitiesKt's dex class)",
    async () => {
      const lists = await fixtureLists((base) => ({ ...base, hooks: [...(base.hooks as string[]), "expo.modules.filesystem.fsops.UtilitiesKt"] }));
      const run = await runDex({ lists });
      expectPass(run);
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 1: D0 fails on a mapping from another build",
    async () => {
      const other = "0".repeat(64);
      const run = await runDex({ mapping: composeMapping().split(PG_MAP_ID).join(other) });
      expectFail(run, /mapping/i);
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 1: D0 fails on a dex with no R8 marker",
    async () => {
      const run = await runDex({ apkEntries: [{ name: "classes.dex", data: dexBytes(null), deflate: true }] });
      expectFail(run);
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 1: D0 fails on an APK with no dex",
    async () => {
      const run = await runDex({ apkEntries: [{ name: "AndroidManifest.xml", data: Buffer.from("no dex here") }] });
      expectFail(run);
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 1: D0 fails when the dump opened fewer dex files than the APK holds",
    async () => {
      const run = await runDex({
        apkEntries: [
          { name: "classes.dex", data: dexBytes(), deflate: true },
          { name: "classes2.dex", data: dexBytes(r8Marker()), deflate: true },
        ],
      });
      expectFail(run);
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 1: D0 fails on a dump with no Octave class",
    async () => {
      const dump = composeDump().replace(/^Class #4348 [\s\S]*?(?=^Class #)/m, "");
      expect(dump).not.toContain("Lsr1;");
      const run = await runDex({ dump });
      expectFail(run);
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 1: D0 fails on a mapping with okhttp3 classes but no okhttp3.OkHttpClient",
    async () => {
      const mapping = composeMapping().replace(/^okhttp3\.OkHttpClient -> vr1:\n/m, "");
      expect(mapping).toMatch(/^okhttp3\./m);
      const run = await runDex({ mapping });
      expectFail(run);
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 1: D0 fails when dexdump exits non-zero",
    async () => {
      const run = await runDex({ dexdumpExit: 2 });
      expectFail(run);
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 1: D0 fails on a missing APK or mapping and says to run pnpm tv:build",
    async () => {
      expectFail(await runDex({ noApk: true }), "pnpm tv:build");
      expectFail(await runDex({ noMapping: true }), "pnpm tv:build");
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 1: the command exits 1 with an ERROR line when the APK is missing",
    () => {
      const child = spawnSync(process.execPath, ["scripts/tv-apk-dex.mjs", join(repo, "no-such-dir", "app-release.apk"), join(repo, "no-such-dir", "mapping.txt")], {
        cwd: repo,
        encoding: "utf8",
      });
      const output = `${child.stdout}\n${child.stderr}`;
      expect(child.status, output).toBe(1);
      expect(output).toMatch(/^ERROR tv apk dex: /m);
    },
    TIMEOUT,
  );
});

describe("T3-19 item 1: the production lists' shape", () => {
  it("T3-19 item 1: every entry-point row has a reason, sinks drawn from the sink ids, and a linkedPath that is null or a LINKED_NETWORK_PATHS id", async () => {
    const lists = await loadProductionLists();
    const sinkIds = (lists.NETWORK_SINKS as { id: string }[]).map((sink) => sink.id);
    for (const id of ["S1", "S2", "S3", "S4", "S5", "S6"]) expect(sinkIds, id).toContain(id);
    const linkedIds = new Set((await linkedNetworkPaths()).map((entry) => entry.id));
    const rows = lists.APK_NETWORK_ENTRY_POINTS as EntryPoint[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(typeof row.id === "string" && row.id.length > 0, JSON.stringify(row)).toBe(true);
      expect(typeof row.reason === "string" && row.reason.trim().length > 0, `${row.id}: reason`).toBe(true);
      expect(Array.isArray(row.classes) && row.classes.length > 0, `${row.id}: classes`).toBe(true);
      for (const name of row.classes) {
        expect(typeof name === "string" && name.length > 0, `${row.id}: class name`).toBe(true);
        expect(name, `${row.id}: a row names classes, never a package`).not.toMatch(/[.*]$/);
      }
      expect(Array.isArray(row.sinks) && row.sinks.length > 0, `${row.id}: sinks`).toBe(true);
      for (const sink of row.sinks) expect(sinkIds, `${row.id}: sink ${sink}`).toContain(sink);
      expect(row.linkedPath === null || linkedIds.has(row.linkedPath), `${row.id}: linkedPath ${row.linkedPath}`).toBe(true);
    }
  });

  it("T3-19 item 1: Networking (R1), WebSocket (R2), Fresco's fetcher (R3) and expo/fetch (E1) each have a row or a source-only entry with a reason", async () => {
    const lists = await loadProductionLists();
    const rows = lists.APK_NETWORK_ENTRY_POINTS as EntryPoint[];
    const sourceOnly = lists.SOURCE_ONLY_LINKED_PATHS as { id: string; reason: string }[];
    for (const id of ["R1", "R2", "R3", "E1"]) {
      const row = rows.some((entry) => entry.linkedPath === id);
      const source = sourceOnly.some((entry) => entry.id === id && typeof entry.reason === "string" && entry.reason.trim().length > 0);
      expect(row || source, `${id} has an entry-point row or a source-only entry with a reason`).toBe(true);
    }
  });

  it("T3-19 item 1: expo-file-system (E2) and @expo/dom-webview (E5) each have a row, a source-only entry, or their Java package on ABSENT_PACKAGES", async () => {
    const lists = await loadProductionLists();
    const rows = lists.APK_NETWORK_ENTRY_POINTS as EntryPoint[];
    const sourceOnly = lists.SOURCE_ONLY_LINKED_PATHS as { id: string; reason: string }[];
    const absent = lists.ABSENT_PACKAGES as string[];
    for (const [id, javaPackage] of [
      ["E2", "expo.modules.filesystem."],
      ["E5", "expo.modules.webview."],
    ]) {
      const row = rows.some((entry) => entry.linkedPath === id);
      const source = sourceOnly.some((entry) => entry.id === id && typeof entry.reason === "string" && entry.reason.trim().length > 0);
      expect(row || source || absent.includes(javaPackage), `${id}: a row, a source-only entry, or ${javaPackage} on ABSENT_PACKAGES`).toBe(true);
    }
  });
});

// --- item 2 (the dex half; the start-up half is scripts/tv-dev-server-watch.test.ts) ------------------------------

describe("T3-19 item 2: DevSupportHttpClient's callers", () => {
  it(
    "T3-19 item 2: the release excerpt passes with its one caller listed",
    async () => {
      expectPass(await runDex());
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 2: D6 fails when a class outside the callers references DevSupportHttpClient",
    async () => {
      const run = await runDex({ dump: composeDump(["caller-dev-support"]), mapping: composeMapping(["caller-dev-support"]) });
      expectFail(run, "com.example.Caller");
    },
    TIMEOUT,
  );

  it(
    "T3-19 item 2: D6 fails on a listed caller the APK does not hold",
    async () => {
      const lists = await fixtureLists((base) => ({
        ...base,
        devSupportCallers: [...(base.devSupportCallers as Lists[]), { class: "com.facebook.react.runtime.ReactHostImpl", offInRelease: "Fixture row." }],
      }));
      const run = await runDex({ lists });
      expectFail(run, "com.facebook.react.runtime.ReactHostImpl");
    },
    TIMEOUT,
  );

  it("T3-19 item 2: every production DEV_SUPPORT_CLIENT_CALLERS row names a class and why it does not run in a release build", async () => {
    const lists = await loadProductionLists();
    const callers = lists.DEV_SUPPORT_CLIENT_CALLERS as { class: string; offInRelease: string }[];
    expect(Array.isArray(callers)).toBe(true);
    for (const caller of callers) {
      expect(typeof caller.class === "string" && caller.class.length > 0, JSON.stringify(caller)).toBe(true);
      expect(typeof caller.offInRelease === "string" && caller.offInRelease.trim().length > 0, `${caller.class}: offInRelease`).toBe(true);
    }
  });

  it("T3-19 item 2: R5's reason says tested, not removed, and names the callers list, the smoke test and the untested C++ gate", async () => {
    const rows = (await linkedNetworkPaths()).filter((entry) => entry.id === "R5");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const reason = plain(row.reason);
      for (const words of ["tested, not removed", "DEV_SUPPORT_CLIENT_CALLERS", "pnpm tv:smoke", "read from source", "not tested"]) {
        expect(reason, `R5's reason holds "${words}"`).toContain(words);
      }
    }
  });
});

// --- item 4 ---------------------------------------------------------------------------------------------------

describe("T3-19 item 4: the tv job runs the dex check on the APK it builds", () => {
  it("T3-19 item 4: pnpm tv:apk:check runs scripts/tv-apk-dex.mjs after the manifest script, and the tv job runs it between tv:build and tv:e2e:build", () => {
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { scripts: Record<string, string> };
    const steps = pkg.scripts["tv:apk:check"].split("&&").map((step) => step.trim());
    const manifest = steps.indexOf("node scripts/tv-apk-manifest.mjs");
    const dex = steps.indexOf("node scripts/tv-apk-dex.mjs");
    expect(manifest, pkg.scripts["tv:apk:check"]).toBeGreaterThan(-1);
    expect(dex, pkg.scripts["tv:apk:check"]).toBeGreaterThan(manifest);

    const lines = readFileSync(join(repo, ".github", "workflows", "ci.yml"), "utf8").split("\n");
    const start = lines.findIndex((line) => line === "  tv:");
    expect(start, "ci.yml has a job named tv").toBeGreaterThan(-1);
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^ {2}\S/.test(line));
    const job = end === -1 ? rest : rest.slice(0, end);
    const step = (command: string) => job.findIndex((line) => new RegExp(`^\\s+(?:- )?run: ${command}\\s*$`).test(line));
    expect(step("pnpm tv:build")).toBeGreaterThan(-1);
    expect(step("pnpm tv:apk:check")).toBeGreaterThan(step("pnpm tv:build"));
    expect(step("pnpm tv:e2e:build")).toBeGreaterThan(step("pnpm tv:apk:check"));
  });
});

// --- item 5 ---------------------------------------------------------------------------------------------------

describe("T3-19 item 5: docs/security.md names the check and what it cannot see", () => {
  it("T3-19 item 5: names the script, its test, the list and the command, and a paragraph says what the dex check cannot see", () => {
    const text = readFileSync(join(repo, "docs", "security.md"), "utf8");
    for (const name of ["scripts/tv-apk-dex.mjs", "scripts/tv-apk-dex.test.ts", "APK_NETWORK_ENTRY_POINTS", "pnpm tv:apk:check"]) {
      expect(text, name).toContain(name);
    }
    const start = text.search(/What the dex check cannot see/i);
    expect(start, 'a paragraph "What the dex check cannot see"').toBeGreaterThan(-1);
    const after = text.slice(start);
    const next = after.slice(1).search(/^#{1,6} /m);
    const paragraph = plain(next === -1 ? after : after.slice(0, next + 1));
    expect(paragraph).toMatch(/native (code|librar)/i);
    expect(paragraph).toMatch(/Hermes/);
    expect(paragraph).toMatch(/reflection/i);
    expect(paragraph).toMatch(/call graph/i);
  });
});
