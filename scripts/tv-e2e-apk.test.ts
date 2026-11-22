// @vitest-environment node
// T3-31 items 1 and 2 (docs/specs/T3-31.md, "The checks"): checkE2eApk runs the dex, inspector and native inspector
// checks on the e2e APK with its own mapping, runs all three whatever the first says, and returns one
// `ERROR tv e2e:` line per failed check.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zipStored } from "./fixtures/tv/native/elf";
import { E2E_APK_CHECKS, checkE2eApk } from "./tv-e2e-apk.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");

const temps: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const DEX = "scripts/tv-apk-dex.mjs";
const INSPECTOR = "scripts/tv-apk-inspector.mjs";
const NATIVE = "scripts/tv-apk-native-inspector.mjs";

type Run = (input: { apk: string; mapping: string }) => number | Promise<number>;
const fakes = (runs: Run[]) => [DEX, INSPECTOR, NATIVE].map((script, index) => ({ script, run: runs[index] as Run }));

describe("T3-31 item 2: checkE2eApk", () => {
  it("T3-31 item 2: E2E_APK_CHECKS names the dex, inspector and native inspector scripts, in that order", () => {
    expect(E2E_APK_CHECKS.map((check: { script: string }) => check.script)).toEqual([DEX, INSPECTOR, NATIVE]);
  });

  it("T3-31 item 2: three checks that return 0 give no error line", async () => {
    expect(await checkE2eApk({ apk: "a.apk", mapping: "m.txt" }, fakes([() => 0, () => 0, () => 0]))).toEqual([]);
  });

  it("T3-31 item 2: the second check returning 1 still runs all three and gives one line naming it, its exit, and the rebuild command", async () => {
    const calls: string[] = [];
    const run = (name: string, code: number): Run => () => {
      calls.push(name);
      return code;
    };
    const lines = await checkE2eApk({ apk: "a.apk", mapping: "m.txt" }, fakes([run("dex", 0), run("inspector", 1), run("native", 0)]));
    expect(calls).toEqual(["dex", "inspector", "native"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^ERROR tv e2e: /);
    expect(lines[0]).toContain(INSPECTOR);
    expect(lines[0]).toContain("(exit 1)");
    expect(lines[0]).toContain("it was not installed");
    expect(lines[0]).toContain("run pnpm tv:e2e:build");
  });

  it("T3-31 item 2: a check that resolves a promise to 1 gives one line, and one that throws gives one line with its message", async () => {
    const resolved = await checkE2eApk({ apk: "a", mapping: "m" }, fakes([() => 0, async () => 1, () => 0]));
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toContain(INSPECTOR);
    const thrown = await checkE2eApk(
      { apk: "a", mapping: "m" },
      fakes([
        () => 0,
        () => 0,
        () => {
          throw new Error("boom detail");
        },
      ]),
    );
    expect(thrown).toHaveLength(1);
    expect(thrown[0]).toMatch(/^ERROR tv e2e: /);
    expect(thrown[0]).toContain(NATIVE);
    expect(thrown[0]).toContain("boom detail");
  });

  it("T3-31 item 2: every failing check gives its own line, in order", async () => {
    const lines = await checkE2eApk({ apk: "a", mapping: "m" }, fakes([() => 1, () => 2, () => 3]));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain(DEX);
    expect(lines[1]).toContain(INSPECTOR);
    expect(lines[2]).toContain(NATIVE);
    expect(lines[2]).toContain("(exit 3)");
  });
});

describe("T3-31 item 1: the checks get the e2e APK and its own mapping", () => {
  it("T3-31 item 1: each fake receives the apk and mapping it was given, unchanged", async () => {
    const seen: { apk: string; mapping: string }[] = [];
    const record: Run = (input) => {
      seen.push(input);
      return 0;
    };
    await checkE2eApk({ apk: "/x/e2e.apk", mapping: "/x/e2e.mapping.txt" }, fakes([record, record, record]));
    expect(seen).toHaveLength(3);
    for (const input of seen) {
      expect(input.apk).toBe("/x/e2e.apk");
      expect(input.mapping).toBe("/x/e2e.mapping.txt");
    }
  });

  it("T3-31 item 1: the real checks on an APK with no dex, and a mapping path that does not exist, name that path and never the release mapping", async () => {
    const dir = mkdtempSync(join(tmpdir(), "octave-t3-31-apk-"));
    temps.push(dir);
    mkdirSync(dir, { recursive: true });
    const apk = join(dir, "octave-tv-e2e.apk");
    // No classes*.dex entry: the inspector check must not start a real dexdump on a machine that has ANDROID_HOME.
    writeFileSync(apk, zipStored([{ name: "AndroidManifest.xml", data: Buffer.from("manifest") }]));
    const mapping = join(dir, "no-such-e2e.mapping.txt");

    const captured: string[] = [];
    const grab = (chunk: unknown) => {
      captured.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stderr, "write").mockImplementation(grab as never);
    vi.spyOn(process.stdout, "write").mockImplementation((() => true) as never);
    vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => void captured.push(parts.join(" ")));
    vi.spyOn(console, "log").mockImplementation(() => {});

    await checkE2eApk({ apk, mapping });
    const text = captured.join("\n");
    expect(text).toMatch(new RegExp(`no R8 mapping at ${mapping.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    expect(text).not.toContain("outputs/mapping/release");
  });

  it("T3-31 item 1: scripts/tv-e2e.mjs and scripts/tv-e2e-apk.mjs name no release mapping", () => {
    for (const path of ["scripts/tv-e2e.mjs", "scripts/tv-e2e-apk.mjs"]) {
      const source = read(path);
      expect(source, path).not.toContain("RELEASE_MAPPING");
      expect(source, path).not.toContain("outputs/mapping");
    }
  });
});
