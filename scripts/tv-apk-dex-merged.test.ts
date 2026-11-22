// @vitest-environment node
// T3-19 decision log 27 (not frozen): what D4 reads exactly after R8 merges classes, rule D7, the mapping reader's
// synthesized mark on field lines, and the condition that every listed class and hook is refused before R8 by the
// Kotlin rule K7 (NetworkPathsBytecodeTest). Without that condition, the set rule below fails open.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemps, composeDump, composeMapping, loadProductionLists, repo, runDex, type DexRun } from "./fixtures/tv/dex/harness";

const TIMEOUT = 60_000;
afterAll(() => cleanTemps());

const errors = (run: DexRun) => run.out.split("\n").filter((line) => line.startsWith("ERROR tv apk dex:"));
const rule = (run: DexRun, id: string) => errors(run).filter((line) => line.startsWith(`ERROR tv apk dex: ${id} `));
const leftBeforeR8 = (run: DexRun) => Number(/^tv apk dex: (\d+) references? from Octave's code named a merged class/m.exec(run.out)?.[1] ?? Number.NaN);

const NETWORKING = "com.facebook.react.modules.network.NetworkingModule";
const PROVIDER = "com.facebook.react.modules.network.OkHttpClientProvider";
const SYNTHESIZED = '      # {"id":"com.android.tools.r8.synthesized"}';

type Method = { name: string; descriptor: string; instructions: string[] };

// One dex class block as dexdump -d writes it; each instruction of a method sits on line 1.
function classBlock(dex: string, methods: Method[]): string {
  const slashed = `L${dex};`;
  return [
    "Class #9400            -",
    `  Class descriptor  : '${slashed}'`,
    "  Access flags      : 0x0011 (PUBLIC FINAL)",
    "  Superclass        : 'Ljava/lang/Object;'",
    "  Interfaces        -",
    "  Static fields     -",
    "  Instance fields   -",
    "  Direct methods    -",
    ...methods.flatMap((m, k) => [
      `    #${k}              : (in ${slashed})`,
      `      name          : '${m.name}'`,
      `      type          : '${m.descriptor}'`,
      "      access        : 0x0009 (PUBLIC STATIC)",
      "      code          -",
      `7f3000:                                        |[7f3000] ${dex}.${m.name}:${m.descriptor}`,
      ...m.instructions.map((text, i) => `7f30${(16 + i * 6).toString(16)}: 0000                                   |${(i * 3).toString(16).padStart(4, "0")}: ${text}`),
      "      catches       : (none)",
      "      positions     :",
      "        0x0000 line=1",
      "      locals        :",
    ]),
    "  Virtual methods   -",
    "",
  ].join("\n");
}

// The Octave probe `zqp` (dev.octave.tv.Probe), whose method `a` holds the instructions.
const PROBE_MAPPING = ["dev.octave.tv.Probe -> zqp:", "    1:9:void dev.octave.tv.Probe.run():10:10 -> a"].join("\n");
const probe = (...instructions: string[]) => classBlock("zqp", [{ name: "a", descriptor: "()V", instructions }]);

// zq1 merges a library class with a listed one; zq2 is a listed class alone (a nested class, matched by `$`); zq3
// merges two listed classes; zq4 is R8's merged lambda scaffolding, its class line a listed class's nested class.
function mergedMapping(synthesizedMarks = true): string {
  return [
    "com.example.Mixed -> zq1:",
    `    1:1:void ${NETWORKING}.poke():5:5 -> b`,
    `${NETWORKING}$Inner -> zq2:`,
    `    1:1:void ${NETWORKING}$Inner.run():3:3 -> a`,
    `${NETWORKING}$Other -> zq3:`,
    `    1:1:void ${PROVIDER}$X.go():4:4 -> b`,
    `${NETWORKING}$Holder$1 -> zq4:`,
    `    int ${NETWORKING}$Holder$1.$r8$classId -> i`,
    ...(synthesizedMarks ? [SYNTHESIZED] : []),
    `    1:1:void ${NETWORKING}$Holder$1.<init>(int):0:0 -> <init>`,
    ...(synthesizedMarks ? [SYNTHESIZED] : []),
    "    1:1:java.lang.Object com.example.Lib$1.invoke():9:9 -> invoke",
  ].join("\n");
}

const run = (dump: string, extra: string) => runDex({ dump: composeDump() + dump, mapping: `${composeMapping()}${extra}\n` });

describe("T3-19 decision log 27: D4 fails a reference to a merged class only when every original is listed", () => {
  it(
    "a type-only reference to a class that merges a listed class with a library class passes D4 and is counted",
    async () => {
      const r = await run(probe("new-instance v0, Lzq1; // type@0000"), `${PROBE_MAPPING}\n${mergedMapping()}`);
      expect(errors(r), r.out).toEqual([]);
      expect(r.code).toBe(0);
      expect(leftBeforeR8(r), r.out).toBe(1);
    },
    TIMEOUT,
  );

  it(
    "a type-only reference to a class that merges only listed classes fails D4 and names each",
    async () => {
      const r = await run(probe("new-instance v0, Lzq3; // type@0000"), `${PROBE_MAPPING}\n${mergedMapping()}`);
      expect(r.code, r.out).toBe(1);
      expect(rule(r, "D4").some((line) => line.includes(`D4 dev.octave.tv.Probe references ${NETWORKING}$Other`)), r.out).toBe(true);
      expect(rule(r, "D4").some((line) => line.includes(`D4 dev.octave.tv.Probe references ${PROVIDER}$X`)), r.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "a type-only reference to an unmerged listed class fails D4",
    async () => {
      const r = await run(probe("check-cast v0, Lzq2; // type@0000"), `${PROBE_MAPPING}\n${mergedMapping()}`);
      expect(r.code, r.out).toBe(1);
      expect(rule(r, "D4").some((line) => line.includes(`D4 dev.octave.tv.Probe references ${NETWORKING}$Inner`)), r.out).toBe(true);
      expect(leftBeforeR8(r), r.out).toBeNaN();
    },
    TIMEOUT,
  );

  it(
    "an invoke on a listed class with a library parameter type still fails D4: each thing named is its own set",
    async () => {
      const r = await run(probe("invoke-static {v0}, Lzq2;.a:(Lzq1;)V // method@0000"), `${PROBE_MAPPING}\n${mergedMapping()}`);
      expect(r.code, r.out).toBe(1);
      expect(rule(r, "D4").some((line) => line.includes(`D4 dev.octave.tv.Probe references ${NETWORKING}$Inner`)), r.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "R8's synthesized merged constructor and class-id field name every original of the merged class, so they pass D4 and are counted",
    async () => {
      const r = await run(probe("invoke-direct {v0, v1}, Lzq4;.<init>:(I)V // method@0000", "iget v1, v0, Lzq4;.i:I // field@0000"), `${PROBE_MAPPING}\n${mergedMapping()}`);
      expect(errors(r), r.out).toEqual([]);
      expect(r.code).toBe(0);
      expect(leftBeforeR8(r), r.out).toBe(2);
    },
    TIMEOUT,
  );

  it(
    "without R8's synthesized mark the same member lines name the listed holder alone, and D4 fails",
    async () => {
      const r = await run(probe("invoke-direct {v0, v1}, Lzq4;.<init>:(I)V // method@0000", "iget v1, v0, Lzq4;.i:I // field@0000"), `${PROBE_MAPPING}\n${mergedMapping(false)}`);
      expect(r.code, r.out).toBe(1);
      expect(rule(r, "D4").some((line) => line.includes(`D4 dev.octave.tv.Probe references ${NETWORKING}$Holder$1`)), r.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "an OkHttp frame inlined into an Octave method is the library's: its operand is not judged as Octave's",
    async () => {
      const mapping = [
        "dev.octave.session.http.OctaveHttp -> zq5:",
        "    1:9:void okhttp3.internal.Util.touch():5:5 -> a",
        "    1:9:void dev.octave.session.http.OctaveHttp.send():20 -> a",
      ].join("\n");
      const dump = classBlock("zq5", [{ name: "a", descriptor: "()V", instructions: [`new-instance v0, L${NETWORKING.replace(/\./g, "/")}; // type@0000`] }]);
      const r = await run(dump, mapping);
      expect(errors(r), r.out).toEqual([]);
      expect(r.code).toBe(0);
    },
    TIMEOUT,
  );
});

describe("T3-19 decision log 27: D7, Octave's classes stand alone", () => {
  const noCode = (dex: string) => classBlock(dex, []);

  it(
    "an Octave class that holds a member of another class fails D7 and names the keep rule",
    async () => {
      const mapping = ["dev.octave.tv.Mixed -> zq6:", "    1:1:void dev.octave.tv.Mixed.run():3:3 -> a", "    1:1:void com.example.Lib.other():4:4 -> b"].join("\n");
      const r = await run(noCode("zq6"), mapping);
      expect(r.code, r.out).toBe(1);
      expect(rule(r, "D7"), r.out).toHaveLength(1);
      expect(rule(r, "D7")[0]).toContain("zq6 (class line dev.octave.tv.Mixed, also com.example.Lib)");
      expect(rule(r, "D7")[0]).toContain("apps/tv/app.config.ts");
    },
    TIMEOUT,
  );

  it(
    "an Octave class that holds a field of another class fails D7",
    async () => {
      const mapping = ["dev.octave.tv.Mixed -> zq6:", "    1:1:void dev.octave.tv.Mixed.run():3:3 -> a", "    int com.example.Lib.count -> c"].join("\n");
      const r = await run(noCode("zq6"), mapping);
      expect(rule(r, "D7"), r.out).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    "a library class with Octave code inlined into it fails D7",
    async () => {
      const mapping = ["com.example.Host -> zq7:", "    1:1:void dev.octave.tv.Helper.help():3:3 -> a", "    1:1:void com.example.Host.run():9 -> a"].join("\n");
      const r = await run(noCode("zq7"), mapping);
      expect(r.code, r.out).toBe(1);
      expect(rule(r, "D7")[0], r.out).toContain("zq7 (class line com.example.Host, also dev.octave.tv.Helper)");
    },
    TIMEOUT,
  );

  it(
    "library code inlined into an Octave method and R8's own synthesized members do not fail D7",
    async () => {
      const mapping = [
        "dev.octave.tv.Own -> zq8:",
        "    1:1:void com.example.Lib.helper():4:4 -> a",
        "    1:1:void dev.octave.tv.Own.run():3 -> a",
        "    int com.example.Lib$1.$r8$classId -> i",
        SYNTHESIZED,
        "    1:1:void com.example.Bridge.bridge():0:0 -> c",
        SYNTHESIZED,
      ].join("\n");
      const r = await run(noCode("zq8"), mapping);
      expect(rule(r, "D7"), r.out).toEqual([]);
      expect(r.code, r.out).toBe(0);
    },
    TIMEOUT,
  );

  it(
    "a mixed mapping section with no class in the dex is not judged",
    async () => {
      const mapping = ["com.example.Host -> zq7:", "    1:1:void dev.octave.tv.Helper.help():3:3 -> a", "    1:1:void com.example.Host.run():9 -> a"].join("\n");
      const r = await run("", mapping);
      expect(rule(r, "D7"), r.out).toEqual([]);
    },
    TIMEOUT,
  );
});

describe("T3-19 decision log 27: the mapping reader", () => {
  it("records R8's synthesized mark on a field line and keeps a field's residual signature", async () => {
    const { parseMapping } = await import("./tv-apk-dex-mapping.mjs");
    const mapping = parseMapping(
      [
        "com.example.A -> a:",
        "    int com.example.A.$r8$classId -> i",
        SYNTHESIZED,
        "    com.example.B com.example.A.b -> b",
        '      # {"id":"com.android.tools.r8.residualsignature","signature":"Lzz;"}',
        "    1:1:void com.example.A.run():3:3 -> c",
      ].join("\n"),
    );
    const fields = mapping.sections.get("a")?.fields ?? [];
    expect(fields.map((f) => [f.name, f.synthesized, f.residual])).toEqual([
      ["i", true, null],
      ["b", false, "Lzz;"],
    ]);
    expect(mapping.sections.get("a")?.stacks[0].frames[0].synthesized).toBe(false);
  });

  it("matches a member's holder by its exact descriptor: a same-named member with another descriptor is no line", async () => {
    const { memberHolders, parseMapping } = await import("./tv-apk-dex-mapping.mjs");
    const mapping = parseMapping(
      [
        "com.example.A -> a:",
        "    1:1:void com.example.B.run(int):3:3 -> c",
        "    1:1:void com.example.C.run():4:4 -> d",
        "    com.example.D com.example.E.f -> f",
      ].join("\n"),
    );
    expect([...memberHolders(mapping, "a", "c", "(I)V", true)]).toEqual(["com.example.B"]);
    expect([...memberHolders(mapping, "a", "c", "()V", true)].sort()).toEqual(["com.example.A", "com.example.B", "com.example.C", "com.example.E"]);
    expect([...memberHolders(mapping, "a", "f", "Lcom/example/D;", false)]).toEqual(["com.example.E"]);
    expect([...memberHolders(mapping, "zz", "f", "I", false)]).toEqual(["zz"]);
  });
});

describe("T3-19 decision log 27: every listed class and hook is refused before R8", () => {
  // The Kotlin rule K7 as NetworkPathsBytecodeTest applies it: a class name in a class file's constant pool that
  // contains one of these strings. NetworkPathRulesCoverageTest (pnpm tv:native:test) runs the rule itself.
  function kotlinK7(): string[] {
    const source = readFileSync(join(repo, "apps/tv/native/app/src/test/java/dev/octave/buildcheck/NetworkPathRules.kt"), "utf8");
    const block = /private val K7 = listOf\(([\s\S]*?)\n {4}\)/.exec(source)?.[1] ?? "";
    // A Kotlin string writes `$` as `\$`.
    return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1].replace(/\\\$/g, "$"));
  }

  it("K7 covers every class of every APK_NETWORK_ENTRY_POINTS row and every ENTRY_POINT_HOOKS name", async () => {
    const k7 = kotlinK7();
    expect(k7.length, "K7 read from NetworkPathRules.kt").toBeGreaterThan(10);
    const lists = await loadProductionLists();
    const rows = lists.APK_NETWORK_ENTRY_POINTS as { id: string; classes: string[] }[];
    const names = [...rows.flatMap((row) => row.classes), ...(lists.ENTRY_POINT_HOOKS as string[])];
    expect(names.length).toBeGreaterThan(0);
    const uncovered = names.filter((name) => !k7.some((entry) => name.replace(/\./g, "/").includes(entry)));
    expect(uncovered, "add each to K7 in NetworkPathRules.kt").toEqual([]);
  });
});
