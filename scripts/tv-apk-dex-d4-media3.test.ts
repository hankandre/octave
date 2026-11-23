// @vitest-environment node
// T8-02, the Product Owner ruling of 2026-11-23 on rule D4 (tasks/product-owner-log.md, "2026-11-23, T8-02 ruling,
// Check", point 5): D4_EXCEPTIONS lets exactly one constructor of Media3's OkHttp data source factory be referenced
// from dev.octave.player.media3, in three shapes (new-instance, invoke-direct, the constructor inlined by R8), and
// nothing else. Each case is a hand-written class block and mapping section appended to the release excerpt, judged
// by the frozen runDex with the fixture lists plus row M1 and the production D4_EXCEPTIONS. Not frozen.
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemps, composeDump, composeMapping, loadFixtureLists, loadProductionLists, runDex, type DexRun } from "./fixtures/tv/dex/harness";

const TIMEOUT = 60_000;

afterAll(() => cleanTemps());

const DATA_SOURCE = "androidx.media3.datasource.okhttp.OkHttpDataSource";
const FACTORY = `${DATA_SOURCE}$Factory`;
const ENGINE = "dev.octave.player.media3.Media3Handle";

const slash = (name: string) => `L${name.replace(/\./g, "/")};`;

// One dex class with one static method `a`, each instruction on its own source line (line i + 1).
function dexClass(name: string, instructions: string[]): string {
  const slashed = slash(name);
  return [
    "Class #9400            -",
    `  Class descriptor  : '${slashed}'`,
    "  Access flags      : 0x0011 (PUBLIC FINAL)",
    "  Superclass        : 'Ljava/lang/Object;'",
    "  Interfaces        -",
    "  Static fields     -",
    "  Instance fields   -",
    "  Direct methods    -",
    `    #0              : (in ${slashed})`,
    "      name          : 'a'",
    "      type          : '(Ljava/lang/Object;)Ljava/lang/Object;'",
    "      access        : 0x0019 (PUBLIC STATIC FINAL)",
    "      code          -",
    `7f0000:                                        |[7f0000] ${name}.a:(Ljava/lang/Object;)Ljava/lang/Object;`,
    ...instructions.map((text, i) => `7f${(16 + i * 6).toString(16).padStart(4, "0")}: 0000                                   |${(i * 3).toString(16).padStart(4, "0")}: ${text}`),
    "      catches       : (none)",
    "      positions     :",
    ...instructions.map((_, i) => `        0x${(i * 3).toString(16).padStart(4, "0")} line=${i + 1}`),
    "      locals        :",
    "",
    "  Virtual methods   -",
    "",
  ].join("\n");
}

// Media3's data source (m3a) holds the S1 invoke row M1 lists; its factory (m3b) has the one constructor, a setter and
// createDataSource. okhttp3.Call$Factory is zz8 and OctaveHttp.callFactory is OctaveHttp.a (sender-one-client).
const LIBRARY_DUMP = dexClass("m3a", ["invoke-interface {v0, v1}, Lzz8;.a:(Lf9;)Lil; // method@0000", "return-object v0"]);
const LIBRARY_MAPPING = [
  `${DATA_SOURCE} -> m3a:`,
  "    1:9:java.lang.Object open(java.lang.Object):1:9 -> a",
  "    1:9:void <init>(okhttp3.Call$Factory,java.lang.String):1:9 -> <init>",
  `${FACTORY} -> m3b:`,
  "    okhttp3.Call$Factory callFactory -> a",
  "    1:9:void <init>(okhttp3.Call$Factory):1:9 -> <init>",
  "    1:9:androidx.media3.datasource.DataSource createDataSource():1:9 -> b",
  `    1:9:${FACTORY} setUserAgent(java.lang.String):1:9 -> c`,
  "com.example.Foreign -> fx1:",
  "    1:9:okhttp3.Call$Factory get():1:9 -> a",
].join("\n");

const CALL_FACTORY = "invoke-static {v1}, Ldev/octave/session/http/OctaveHttp;.a:(Ljava/lang/String;)Lzz8; // method@0000";
const NEW_FACTORY = "new-instance v0, Lm3b; // type@0000";
const INIT_FACTORY = "invoke-direct {v0, v1}, Lm3b;.<init>:(Lzz8;)V // method@0000";
const CONSTRUCT = [CALL_FACTORY, "move-result-object v1", NEW_FACTORY, INIT_FACTORY, "return-object v0"];

const plainSection = (name: string, extra: string[] = []) => [`${name} -> ${name}:`, ...extra, "    1:9:java.lang.Object build(java.lang.Object):1:9 -> a"].join("\n");

type Case = { dump: string; mapping: string };

const plain = (name: string, instructions: string[], extra: string[] = []): Case => ({ dump: dexClass(name, instructions), mapping: plainSection(name, extra) });

async function judge(cases: Case[]): Promise<{ run: DexRun; errors: string[] }> {
  const { FIXTURE_LISTS } = await loadFixtureLists();
  const production = await loadProductionLists();
  const m1 = (production.APK_NETWORK_ENTRY_POINTS as { id: string }[]).find((row) => row.id === "M1");
  expect(m1, "APK_NETWORK_ENTRY_POINTS has row M1").toBeDefined();
  const lists = {
    ...FIXTURE_LISTS,
    entryPoints: [...(FIXTURE_LISTS.entryPoints as unknown[]), m1],
    d4Exceptions: production.D4_EXCEPTIONS,
  };
  const dump = composeDump(["sender-one-client"]) + LIBRARY_DUMP + cases.map((c) => c.dump).join("");
  const mapping = [composeMapping(["sender-one-client"]), LIBRARY_MAPPING, ...cases.map((c) => c.mapping), ""].join("\n");
  const run = await runDex({ dump, mapping, lists });
  return { run, errors: run.out.split("\n").filter((line) => line.startsWith("ERROR tv apk dex:")) };
}

const d4 = (errors: string[], holder: string, name = FACTORY) => errors.filter((line) => line.includes(`D4 ${holder}`) && line.includes(`references ${name} `));

describe("T8-02 D4_EXCEPTIONS: Octave's engine package may construct Media3's OkHttp data source factory, and nothing else", () => {
  it(
    "the production list holds exactly one entry, for that constructor from dev.octave.player.media3., with a reason",
    async () => {
      const production = await loadProductionLists();
      expect(production.D4_EXCEPTIONS).toEqual([
        {
          id: "E1",
          package: "dev.octave.player.media3.",
          class: FACTORY,
          constructor: ["okhttp3.Call$Factory"],
          reason: expect.stringMatching(/OctaveHttp\.callFactory\(session\)/),
        },
      ]);
      expect((production.PRODUCTION_LISTS as { d4Exceptions: unknown }).d4Exceptions).toBe(production.D4_EXCEPTIONS);
    },
    TIMEOUT,
  );

  it(
    "passes new-instance and invoke-direct of the constructor from dev.octave.player.media3.",
    async () => {
      const { run, errors } = await judge([plain(ENGINE, CONSTRUCT)]);
      expect(errors, run.out).toEqual([]);
      expect(run.code, run.out).toBe(0);
    },
    TIMEOUT,
  );

  it(
    "passes the constructor inlined by R8 into the engine's method",
    async () => {
      const inlined: Case = {
        dump: dexClass(ENGINE, [CALL_FACTORY, NEW_FACTORY, "invoke-direct {v0}, Ljava/lang/Object;.<init>:()V // method@0000", "iput-object v1, v0, Lm3b;.a:Lzz8; // field@0000", "return-object v0"]),
        mapping: [
          `${ENGINE} -> ${ENGINE}:`,
          "    1:2:java.lang.Object build(java.lang.Object):1:2 -> a",
          `    3:4:void ${FACTORY}.<init>(okhttp3.Call$Factory):50:51 -> a`,
          "    3:4:java.lang.Object build(java.lang.Object):3 -> a",
          "    5:9:java.lang.Object build(java.lang.Object):5:9 -> a",
        ].join("\n"),
      };
      const { run, errors } = await judge([inlined]);
      expect(errors, run.out).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "fails a method of another class inlined into the engine (the control for the inlined shape)",
    async () => {
      const inlined: Case = {
        dump: dexClass(ENGINE, [CALL_FACTORY, NEW_FACTORY, INIT_FACTORY, "invoke-virtual {v0}, Ljava/lang/Object;.hashCode:()I // method@0000", "return-object v0"]),
        mapping: [
          `${ENGINE} -> ${ENGINE}:`,
          "    1:3:java.lang.Object build(java.lang.Object):1:3 -> a",
          `    4:4:${FACTORY} ${FACTORY}.setUserAgent(java.lang.String):60:60 -> a`,
          "    4:4:java.lang.Object build(java.lang.Object):4 -> a",
          "    5:9:java.lang.Object build(java.lang.Object):5:9 -> a",
        ].join("\n"),
      };
      const { run, errors } = await judge([inlined]);
      expect(d4(errors, ENGINE).length, run.out).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  for (const holder of ["dev.octave.tv.Probe", "dev.octave.player.Other", "dev.octave.player.media3x.Other"]) {
    it(
      `fails the same constructor from ${holder}`,
      async () => {
        const { run, errors } = await judge([plain(ENGINE, CONSTRUCT), plain(holder, CONSTRUCT)]);
        expect(d4(errors, holder).length, run.out).toBeGreaterThan(0);
        expect(d4(errors, ENGINE), run.out).toEqual([]);
      },
      TIMEOUT,
    );
  }

  const inside: [string, string[], string[], string?][] = [
    ["a setter", [...CONSTRUCT.slice(0, 4), "invoke-virtual {v0, v1}, Lm3b;.c:(Ljava/lang/String;)Lm3b; // method@0000", "return-object v0"], []],
    ["createDataSource", [...CONSTRUCT.slice(0, 4), "invoke-virtual {v0}, Lm3b;.b:()Landroidx/media3/datasource/DataSource; // method@0000", "return-object v0"], []],
    ["the outer class's constructor", [CALL_FACTORY, "move-result-object v1", "new-instance v0, Lm3a; // type@0000", "invoke-direct {v0, v1, v1}, Lm3a;.<init>:(Lzz8;Ljava/lang/String;)V // method@0000", "return-object v0"], [], DATA_SOURCE],
    ["a check-cast", [...CONSTRUCT.slice(0, 4), "check-cast v0, Lm3b; // type@0000", "return-object v0"], []],
    ["an instance-of", [...CONSTRUCT.slice(0, 4), "instance-of v0, v0, Lm3b; // type@0000", "return-object v0"], []],
    ["a const-class", [...CONSTRUCT.slice(0, 4), "const-class v0, Lm3b; // type@0000", "return-object v0"], []],
    [
      "a field typed as the factory",
      [...CONSTRUCT.slice(0, 4), `iget-object v0, v1, ${slash(ENGINE)}.b:Lm3b; // field@0000`, "return-object v0"],
      [`    ${FACTORY} factory -> b`],
    ],
  ];
  for (const [what, instructions, extra, name] of inside) {
    it(
      `fails ${what} from inside dev.octave.player.media3`,
      async () => {
        const { run, errors } = await judge([plain(ENGINE, instructions, extra)]);
        expect(d4(errors, ENGINE, name ?? FACTORY).length, run.out).toBeGreaterThan(0);
      },
      TIMEOUT,
    );
  }

  it(
    "fails the constructor from a synthetic-only site in the package (R8's merged lambda)",
    async () => {
      const lambda = "dev.octave.player.media3.Media3Handle$$ExternalSyntheticLambda0";
      const synthetic: Case = {
        dump: dexClass("lx9", CONSTRUCT),
        mapping: [`${lambda} -> lx9:`, '# {"id":"sourceFile","fileName":"Media3Handle.kt"}', '# {"id":"com.android.tools.r8.synthesized"}', "    1:9:java.lang.Object build(java.lang.Object):1:9 -> a"].join("\n"),
      };
      const { run, errors } = await judge([plain(ENGINE, CONSTRUCT), synthetic]);
      expect(errors.filter((line) => line.includes("D4") && line.includes(lambda) && line.includes(FACTORY)).length, run.out).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    "fails an entry no reference in the APK uses",
    async () => {
      const { run, errors } = await judge([]);
      expect(errors.some((line) => line.includes("D4 exception E1") && line.includes("no reference")), run.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "still fails D1 for an engine class that takes a Call$Factory from a foreign class",
    async () => {
      const foreign = ["invoke-static {}, Lfx1;.a:()Lzz8; // method@0000", "move-result-object v1", NEW_FACTORY, INIT_FACTORY, "return-object v0"];
      const { run, errors } = await judge([plain(ENGINE, foreign)]);
      expect(errors.some((line) => line.includes(`D1 ${ENGINE} takes a call or web socket factory from com.example.Foreign`)), run.out).toBe(true);
    },
    TIMEOUT,
  );
});
