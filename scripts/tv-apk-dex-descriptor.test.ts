// @vitest-environment node
// T3-19 decision log 26 (not frozen): D4 reads a member reference's descriptor by the member's own signature on its
// member lines, not as every original class its merged dex types hold. R8 merges unrelated classes into one dex class
// (horizontal class merging), so a descriptor naming that dex class names every merged original; on the release build
// of the CI tv run 45013256258, `HostClassifier` failed D4 on `Regex.matchEntire`'s return type, whose dex class also
// holds merged `DevServerHelper` code. Sinks keep the wide reading always.
// Decision log 27 changed the fallback: with no member line of that descriptor, each dex type is a set of every
// original it holds, and D4 fails only when every original in a set is listed. A set that mixes listed and unlisted
// originals is not a D4 failure; the check counts it as left to NetworkPathsBytecodeTest, which reads Octave's
// classes before R8. The cases below that once failed on the wide reading now pass and are counted.
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemps, composeDump, composeMapping, runDex, type DexRun } from "./fixtures/tv/dex/harness";

const TIMEOUT = 60_000;
afterAll(() => cleanTemps());

const errors = (run: DexRun) => run.out.split("\n").filter((line) => line.startsWith("ERROR tv apk dex:"));
const d4 = (run: DexRun) => errors(run).filter((line) => line.includes(" D4 "));
// The number of Octave references the check left to the test before R8, from its second pass line.
const leftBeforeR8 = (run: DexRun) => Number(/^tv apk dex: (\d+) references? from Octave's code named a merged class/m.exec(run.out)?.[1] ?? Number.NaN);

const HOOK_MEMBER = "com.facebook.react.modules.network.OkHttpClientProvider$Holder";

// `mg` is a merged dex class: its class line is a library class, and one member comes from a nested class of a client
// hook. `lb` is a library class whose members return or hold `mg`.
function mapping(): string {
  return [
    "com.example.Merged -> mg:",
    `    1:1:void ${HOOK_MEMBER}.touch():5:5 -> b`,
    "com.example.Other -> mh:",
    `    1:1:void ${HOOK_MEMBER}.poke():6:6 -> b`,
    "com.example.Lib -> lb:",
    "    com.example.Merged com.example.Lib.INSTANCE -> f",
    `    ${HOOK_MEMBER} com.example.Lib.HOLDER -> h`,
    // R8 writes a residual signature when a member's type is a merged class: the dex type is `mg`, the source's the hook.
    '      # {"id":"com.android.tools.r8.residualsignature","signature":"Lmg;"}',
    "    1:1:com.example.Merged com.example.Lib.get():7:7 -> a",
    `    1:1:${HOOK_MEMBER} com.example.Lib.holder():9:9 -> c`,
    '      # {"id":"com.android.tools.r8.residualsignature","signature":"()Lmg;"}',
    "dev.octave.tv.Probe -> pq:",
    "    1:9:void dev.octave.tv.Probe.run():10:10 -> a",
  ].join("\n");
}

function dump(instruction: string): string {
  return [
    "Class #9300            -",
    "  Class descriptor  : 'Lpq;'",
    "  Access flags      : 0x0011 (PUBLIC FINAL)",
    "  Superclass        : 'Ljava/lang/Object;'",
    "  Interfaces        -",
    "  Static fields     -",
    "  Instance fields   -",
    "  Direct methods    -",
    "    #0              : (in Lpq;)",
    "      name          : 'a'",
    "      type          : '()V'",
    "      access        : 0x0009 (PUBLIC STATIC)",
    "      code          -",
    "7f2000:                                        |[7f2000] pq.a:()V",
    `7f2010: 0000                                   |0000: ${instruction}`,
    "      catches       : (none)",
    "      positions     :",
    "        0x0000 line=1",
    "      locals        :",
    "  Virtual methods   -",
    "",
  ].join("\n");
}

const run = (instruction: string) => runDex({ dump: composeDump() + dump(instruction), mapping: `${composeMapping()}${mapping()}\n` });

describe("T3-19 decision log 26, read with 27: D4 reads a member reference's descriptor by the member's own signature", () => {
  it(
    "a method whose own return type is a library class passes, though its dex return type also holds a hook's merged code",
    async () => {
      const r = await run("invoke-static {}, Llb;.a:()Lmg; // method@0000");
      expect(d4(r), r.out).toEqual([]);
      expect(r.code, r.out).toBe(0);
      expect(leftBeforeR8(r), r.out).toBe(0);
    },
    TIMEOUT,
  );

  it(
    "a field whose own type is a library class passes, though its dex type also holds a hook's merged code",
    async () => {
      const r = await run("sget-object v0, Llb;.f:Lmg; // field@0000");
      expect(d4(r), r.out).toEqual([]);
      expect(r.code, r.out).toBe(0);
      expect(leftBeforeR8(r), r.out).toBe(0);
    },
    TIMEOUT,
  );

  it(
    "a method whose own signature names a hook still fails D4",
    async () => {
      const r = await run("invoke-static {}, Llb;.c:()Lmg; // method@0000");
      expect(r.code, r.out).toBe(1);
      expect(d4(r).some((line) => line.includes(`D4 dev.octave.tv.Probe references ${HOOK_MEMBER}`)), r.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "a field whose own type is a hook still fails D4",
    async () => {
      const r = await run("sget-object v0, Llb;.h:Lmg; // field@0000");
      expect(r.code, r.out).toBe(1);
      expect(d4(r).some((line) => line.includes(`D4 dev.octave.tv.Probe references ${HOOK_MEMBER}`)), r.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "a member with no member line reads each dex type as a set: a set that mixes a hook with other code passes D4 and is counted",
    async () => {
      const r = await run("invoke-static {}, Llb;.z:()Lmg; // method@0000");
      expect(d4(r), r.out).toEqual([]);
      expect(r.code, r.out).toBe(0);
      expect(leftBeforeR8(r), r.out).toBe(1);
    },
    TIMEOUT,
  );

  it(
    "a same-named method with another descriptor does not lend its signature: the dex type is read as a set, passes D4 and is counted",
    async () => {
      const r = await run("invoke-static {v0}, Llb;.a:(I)Lmg; // method@0000");
      expect(d4(r), r.out).toEqual([]);
      expect(r.code, r.out).toBe(0);
      expect(leftBeforeR8(r), r.out).toBe(1);
    },
    TIMEOUT,
  );

  it(
    "a same-named field with another type does not lend its type: the dex type is read as a set, passes D4 and is counted",
    async () => {
      const r = await run("sget-object v0, Llb;.f:Lmh; // field@0000");
      expect(d4(r), r.out).toEqual([]);
      expect(r.code, r.out).toBe(0);
      expect(leftBeforeR8(r), r.out).toBe(1);
    },
    TIMEOUT,
  );

  it(
    "a type-only reference to a merged class that mixes a hook with other code passes D4 and is counted",
    async () => {
      const r = await run("new-instance v0, Lmg; // type@0000");
      expect(d4(r), r.out).toEqual([]);
      expect(r.code, r.out).toBe(0);
      expect(leftBeforeR8(r), r.out).toBe(1);
    },
    TIMEOUT,
  );
});
