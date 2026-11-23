// @vitest-environment node
// T8-01 (not frozen): how the dex check reads an outline's positions (Product Owner ruling of 2026-11-23, on
// docs/specs/T8-01.md "Risks and out of scope"). The mapping lines are cut from the release build of T8-01 (R8 9.2.14,
// mapping version 2.2), section dev.octave.player.OctavePlayerModule; only the dex class name is changed.
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemps, composeDump, composeMapping, runDex, type DexRun } from "./fixtures/tv/dex/harness";
import { framesAt, parseMapping } from "./tv-apk-dex-mapping.mjs";
import { mixedClasses } from "./tv-apk-dex-merged.mjs";

const TIMEOUT = 60_000;
afterAll(() => cleanTemps());

const MODULE = "dev.octave.player.OctavePlayerModule";
const BUILDER = "expo.modules.kotlin.modules.InternalModuleDefinitionBuilder";
const REGISTER = `void ${BUILDER}.registerViewDefinition(expo.modules.kotlin.views.ViewManagerDefinition)`;
const POSITIONS = [1208, 1210, 1213, 1217, 1222];
const CALLSITE =
  '      # {"id":"com.android.tools.r8.outlineCallsite","positions":{"1":1208,"3":1210,"6":1213,"9":1217,"12":1222},"outline":"Ldq2;l(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;"}';

type Cut = { comment?: boolean; outermost?: string; extraLines?: string[] };

function moduleSection({ comment = true, outermost = "ModuleDefinitionData OctavePlayerModule.definition():0", extraLines = [] }: Cut = {}): string {
  return [
    `${MODULE} -> zq9:`,
    "    1207:1207:expo.modules.kotlin.modules.ModuleDefinitionData definition():423:423 -> b",
    "    1207:1207:ModuleDefinitionData OctavePlayerModule.definition():0 -> b",
    `    1171:1174:${REGISTER}:0:0 -> b`,
    "    1171:1174:expo.modules.kotlin.modules.ModuleDefinitionData definition():419 -> b",
    `    1171:1174:${outermost} -> b`,
    ...(comment ? [CALLSITE] : []),
    ...POSITIONS.map((line) => `    ${line}:${line}:${REGISTER}:79:79 -> b`),
    ...extraLines,
  ].join("\n");
}

const mixed = (text: string) => mixedClasses(parseMapping(text), ["zq9"]);

describe("T8-01: an outline position is read by the method R8 took the outline from", () => {
  it("this build's shape passes D7: each position takes the call site's outer frames", () => {
    expect(mixed(moduleSection())).toEqual([]);
    const mapping = parseMapping(moduleSection());
    for (const line of POSITIONS) {
      expect(framesAt(mapping, "zq9", "b", null, line), `line ${line}`).toEqual([[BUILDER, MODULE, MODULE]]);
    }
  });

  it("the same lines without the outline comment fail D7", () => {
    expect(mixed(moduleSection({ comment: false }))).toEqual([{ dex: "zq9", original: MODULE, other: BUILDER }]);
    expect(framesAt(parseMapping(moduleSection({ comment: false })), "zq9", "b", null, 1208)).toEqual([[BUILDER]]);
  });

  it("a position under a call site whose outermost frame is not dev.octave. fails D7", () => {
    const cut = moduleSection({ outermost: "ModuleDefinitionData expo.modules.kotlin.modules.Module.definition():0" });
    expect(mixed(cut)).toHaveLength(1);
    expect(framesAt(parseMapping(cut), "zq9", "b", null, 1208)).toEqual([[BUILDER, MODULE, "expo.modules.kotlin.modules.Module"]]);
  });

  it("a one-line stack on a line the comment does not list is read as written and fails D7", () => {
    const cut = moduleSection({ extraLines: [`    1230:1230:${REGISTER}:79:79 -> b`] });
    expect(mixed(cut)).toEqual([{ dex: "zq9", original: MODULE, other: BUILDER }]);
  });

  it("a listed line in another dex method is read as written and fails D7", () => {
    const cut = moduleSection({ extraLines: [`    1208:1208:${REGISTER}:79:79 -> c`] });
    expect(mixed(cut)).toEqual([{ dex: "zq9", original: MODULE, other: BUILDER }]);
  });

  it("a position whose outermost frame is not the call site's innermost method is read as written and fails D7", () => {
    const cut = moduleSection().replace(`    1213:1213:${REGISTER}:79:79 -> b`, "    1213:1213:void com.example.Lib.other():5:5 -> b");
    expect(mixed(cut)).toEqual([{ dex: "zq9", original: MODULE, other: "com.example.Lib" }]);
  });

  it("a line two call sites of the method list is read as written and fails D7", () => {
    const second = [
      "    1300:1301:expo.modules.kotlin.modules.ModuleDefinitionData definition():0:0 -> b",
      "    1300:1301:ModuleDefinitionData OctavePlayerModule.definition():0 -> b",
      '      # {"id":"com.android.tools.r8.outlineCallsite","positions":{"1":1208},"outline":"Ldq2;l(Ljava/lang/String;)Ljava/lang/String;"}',
    ];
    expect(mixed(moduleSection({ extraLines: second }))).toEqual([{ dex: "zq9", original: MODULE, other: BUILDER }]);
  });
});

describe("T8-01: the dex check passes this build's outline and still fails it without the comment", () => {
  const block = [
    "Class #9401            -",
    "  Class descriptor  : 'Lzq9;'",
    "  Access flags      : 0x0011 (PUBLIC FINAL)",
    "  Superclass        : 'Ljava/lang/Object;'",
    "  Interfaces        -",
    "  Static fields     -",
    "  Instance fields   -",
    "  Direct methods    -",
    "  Virtual methods   -",
    "",
  ].join("\n");
  const run = (section: string): Promise<DexRun> => runDex({ dump: composeDump() + block, mapping: `${composeMapping()}${section}\n` });
  const d7 = (r: DexRun) => r.out.split("\n").filter((line) => line.startsWith("ERROR tv apk dex: D7 "));

  it(
    "with the comment",
    async () => {
      const r = await run(moduleSection());
      expect(d7(r), r.out).toEqual([]);
      expect(r.code, r.out).toBe(0);
    },
    TIMEOUT,
  );

  it(
    "without the comment",
    async () => {
      const r = await run(moduleSection({ comment: false }));
      expect(r.code, r.out).toBe(1);
      expect(d7(r)[0], r.out).toContain(`zq9 (class line ${MODULE}, also ${BUILDER})`);
    },
    TIMEOUT,
  );
});
