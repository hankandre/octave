// @vitest-environment node
// T3-19 review fix (not frozen): code R8 attributes only to a merged lambda group's synthesized `invoke()` frame. A
// method reference R8 folds into the group's dispatch keeps no frame of the source that made it, so:
// - in a group that holds `dev.octave.` code anywhere, a synthetic-only site is judged as Octave's code (D1, D4);
// - outside Octave's code, a sink there is judged by the holder of the member it references (D2), never by the group's
//   name, which follows R8's choice of lambda; a type-only sink there fails D2;
// - a member of a client hook referenced from a synthetic-only site fails D4 whatever the group holds;
// - R8's own cast of a captured value back to its type is not a D4 reference; sinks are still judged there.
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemps, composeDump, composeMapping, loadFixtureLists, loadProductionLists, runDex, type DexRun, type Lists } from "./fixtures/tv/dex/harness";

const TIMEOUT = 60_000;
afterAll(() => cleanTemps());

const errors = (run: DexRun) => run.out.split("\n").filter((line) => line.startsWith("ERROR tv apk dex:"));

const GROUP = "com.example.Group$$ExternalSyntheticLambda0";
const PROVIDER = "Lcom/facebook/react/modules/network/OkHttpClientProvider;";
const SET_FACTORY = `invoke-static {v0}, ${PROVIDER}.setOkHttpClientFactory:(Lcom/facebook/react/modules/network/OkHttpClientFactory;)V // method@0000`;
const GET_CLIENT = `invoke-static {}, ${PROVIDER}.getOkHttpClient:()Lvr1; // method@0000`;
const NETWORKING_GET = "invoke-static {}, Lcom/swmansion/worklets/networking/Networking;.a:()Lvr1; // method@0000";
const CLEAR_COOKIES = "invoke-virtual {v0}, Lcom/facebook/react/modules/network/NetworkingModule;.clearCookies:(Lcom/facebook/react/bridge/Callback;)V // method@0000";
const NO_SINK = "invoke-static {}, Ljava/lang/System;.nanoTime:()J // method@0000";

// R8's merged lambda group as the release mapping writes it (`z6`, `u3`): a synthesized section, one lambda framed by
// its source at lines 1-2, and R8's own dispatch, framed only by the synthetic invoke(), at lines 3-9.
function groupMapping(octave: boolean): string {
  const lambda = octave ? "dev.octave.tv.MainApplication" : "com.example.Lib";
  return [
    `${GROUP} -> zg:`,
    '# {"id":"sourceFile","fileName":"R8$$SyntheticClass"}',
    '# {"id":"com.android.tools.r8.synthesized"}',
    `    1:2:java.lang.Object ${lambda}.host$lambda$1(${lambda}):21:21 -> invoke`,
    "    1:2:java.lang.Object Group$$ExternalSyntheticLambda0.invoke():0 -> invoke",
    "    3:9:java.lang.Object Group$$ExternalSyntheticLambda0.invoke():0:0 -> invoke",
  ].join("\n");
}

// The group's dex class with `invoke()`; each instruction sits on the line given with it.
function groupDump(rows: [number, string][]): string {
  return [
    "Class #9200            -",
    "  Class descriptor  : 'Lzg;'",
    "  Access flags      : 0x0011 (PUBLIC FINAL)",
    "  Superclass        : 'Ljava/lang/Object;'",
    "  Interfaces        -",
    "  Static fields     -",
    "  Instance fields   -",
    "  Direct methods    -",
    "  Virtual methods   -",
    "    #0              : (in Lzg;)",
    "      name          : 'invoke'",
    "      type          : '()Ljava/lang/Object;'",
    "      access        : 0x0011 (PUBLIC FINAL)",
    "      code          -",
    "7f1000:                                        |[7f1000] zg.invoke:()Ljava/lang/Object;",
    ...rows.map(([, text], i) => `7f10${(16 + i * 6).toString(16)}: 0000                                   |${(i * 3).toString(16).padStart(4, "0")}: ${text}`),
    "      catches       : (none)",
    "      positions     :",
    ...rows.map(([line], i) => `        0x${(i * 3).toString(16).padStart(4, "0")} line=${line}`),
    "      locals        :",
    "",
  ].join("\n");
}

async function run(octave: boolean, rows: [number, string][], lists?: Lists): Promise<DexRun> {
  return runDex({ dump: composeDump() + groupDump(rows), mapping: `${composeMapping()}${groupMapping(octave)}\n`, lists });
}

async function listsWith(...rows: Lists[]): Promise<Lists> {
  const { FIXTURE_LISTS, FIXTURE_ENTRY_POINTS } = await loadFixtureLists();
  return { ...FIXTURE_LISTS, entryPoints: [...FIXTURE_ENTRY_POINTS, ...rows] };
}

const row = (id: string, cls: string): Lists => ({ id, classes: [cls], sinks: ["S1"], what: "test row", reason: "test row", linkedPath: null });

describe("T3-19 review fix: code R8 attributes only to a merged lambda group's synthetic frame", () => {
  it(
    "(a) a hook setter on a line with a dev.octave. frame fails D4",
    async () => {
      const r = await run(true, [[1, SET_FACTORY]]);
      expect(r.code, r.out).toBe(1);
      expect(errors(r).some((line) => line.includes("D4 dev.octave.tv.MainApplication references com.facebook.react.modules.network.OkHttpClientProvider")), r.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "(b) the same setter on a synthetic-only line, in a group that holds dev.octave. code, fails D4 and names the group as R8's",
    async () => {
      const r = await run(true, [[3, SET_FACTORY]]);
      expect(r.code, r.out).toBe(1);
      expect(
        errors(r).some((line) => line.includes(`D4 ${GROUP} (R8's merged lambda class, which holds dev.octave. code) references com.facebook.react.modules.network.OkHttpClientProvider`)),
        r.out,
      ).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "(b) the same setter on a synthetic-only line, in a group that holds no dev.octave. code, still fails D4",
    async () => {
      const r = await run(false, [[3, SET_FACTORY]]);
      expect(r.code, r.out).toBe(1);
      expect(errors(r).some((line) => line.startsWith(`ERROR tv apk dex: D4 ${GROUP}`) && line.includes("OkHttpClientProvider.setOkHttpClientFactory")), r.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "(c) the client getter on a synthetic-only line, in a group that holds dev.octave. code, fails D1 even when a row names the group",
    async () => {
      const r = await run(true, [[3, GET_CLIENT]], await listsWith(row("FXG", GROUP)));
      expect(r.code, r.out).toBe(1);
      expect(errors(r).some((line) => line.startsWith(`ERROR tv apk dex: D1 ${GROUP}`) && line.includes("S1")), r.out).toBe(true);
      expect(errors(r).some((line) => line.includes("D4") && line.includes("OkHttpClientProvider")), r.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "(c) the client getter on a synthetic-only line, in a group that holds no dev.octave. code, fails D4 as a hook",
    async () => {
      const r = await run(false, [[3, GET_CLIENT]]);
      expect(r.code, r.out).toBe(1);
      expect(errors(r).some((line) => line.includes("D4") && line.includes("OkHttpClientProvider.getOkHttpClient")), r.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "a library sink on a synthetic-only line is judged by the member's holder: it passes on that holder's row, not on a row naming the group",
    async () => {
      const passes = await run(false, [[3, NETWORKING_GET]], await listsWith(row("FXW", "com.swmansion.worklets.networking.Networking")));
      expect(errors(passes), passes.out).toEqual([]);
      expect(passes.code).toBe(0);

      const byGroup = await run(false, [[3, NETWORKING_GET]], await listsWith(row("FXG", GROUP)));
      expect(byGroup.code, byGroup.out).toBe(1);
      expect(errors(byGroup).some((line) => line.includes("D2 com.swmansion.worklets.networking.Networking holds S1")), byGroup.out).toBe(true);
      expect(errors(byGroup).some((line) => line.includes(`D3 row FXG names ${GROUP}`)), byGroup.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "a type-only sink on a synthetic-only line outside Octave's code fails D2 on the group",
    async () => {
      const r = await run(false, [[3, "new-instance v0, Lvr1; // type@0000"]]);
      expect(r.code, r.out).toBe(1);
      expect(errors(r).some((line) => line.includes(`D2 ${GROUP} holds S1`)), r.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "R8's cast of a captured value in a group with dev.octave. code is not a D4 reference; an invoke on the listed class there is",
    async () => {
      const cast = "check-cast v0, Lcom/facebook/react/modules/network/NetworkingModule; // type@0000";
      const passes = await run(true, [[3, cast], [4, NO_SINK]]);
      expect(errors(passes), passes.out).toEqual([]);
      expect(passes.code).toBe(0);

      const invoke = "invoke-virtual {v0}, Lcom/facebook/react/modules/network/NetworkingModule;.clearCookies:(Lcom/facebook/react/bridge/Callback;)V // method@0000";
      const fails = await run(true, [[3, cast], [4, invoke]]);
      expect(fails.code, fails.out).toBe(1);
      expect(errors(fails).some((line) => line.includes("D4") && line.includes("references com.facebook.react.modules.network.NetworkingModule")), fails.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "R8's cast of a captured value to OkHttpClient in a group with dev.octave. code still fails D1",
    async () => {
      const r = await run(true, [[3, "check-cast v0, Lvr1; // type@0000"]]);
      expect(r.code, r.out).toBe(1);
      expect(errors(r).some((line) => line.startsWith(`ERROR tv apk dex: D1 ${GROUP}`)), r.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "an instruction in the group that no member line covers follows the same rules (entry 17's class-line fallback)",
    async () => {
      const hook = await run(false, [[50, SET_FACTORY]]);
      expect(hook.code, hook.out).toBe(1);
      expect(errors(hook).some((line) => line.startsWith(`ERROR tv apk dex: D4 ${GROUP}`) && line.includes("OkHttpClientProvider.setOkHttpClientFactory")), hook.out).toBe(true);

      const listed = await run(true, [[50, CLEAR_COOKIES]]);
      expect(listed.code, listed.out).toBe(1);
      expect(errors(listed).some((line) => line.includes(`D4 ${GROUP} (R8's merged lambda class`) && line.includes("references com.facebook.react.modules.network.NetworkingModule")), listed.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "an unresolved site in a class whose dev.octave. frame is only an inner frame is judged as Octave's code (D4)",
    async () => {
      const merged = [
        "com.example.Merged -> zm:",
        "    1:4:void dev.octave.tv.Inlined.run():8:8 -> a",
        "    1:4:void com.example.Merged.outer():3 -> a",
      ].join("\n");
      const dump = composeDump() + groupDump([[20, CLEAR_COOKIES]]).replaceAll("Lzg;", "Lzm;").replaceAll("zg.invoke", "zm.b");
      const r = await runDex({ dump, mapping: `${composeMapping()}${merged}\n` });
      expect(r.code, r.out).toBe(1);
      expect(errors(r).some((line) => line.includes("D4 unresolved:zm.b") && line.includes("references com.facebook.react.modules.network.NetworkingModule")), r.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "a cast to a listed class in a synthesized class whose own class line is dev.octave. still fails D4, as before the review fix",
    async () => {
      const own = "dev.octave.tv.Foo$$ExternalSyntheticLambda0";
      const mapping = [
        `${own} -> zh:`,
        '# {"id":"sourceFile","fileName":"R8$$SyntheticClass"}',
        '# {"id":"com.android.tools.r8.synthesized"}',
        `    1:9:java.lang.Object ${own}.invoke():0:0 -> invoke`,
      ].join("\n");
      const cast = "check-cast v0, Lcom/facebook/react/modules/network/NetworkingModule; // type@0000";
      const dump = composeDump() + groupDump([[3, cast]]).replaceAll("Lzg;", "Lzh;").replaceAll("zg.invoke", "zh.invoke");
      const r = await runDex({ dump, mapping: `${composeMapping()}${mapping}\n` });
      expect(r.code, r.out).toBe(1);
      expect(
        errors(r).some((line) => line.startsWith(`ERROR tv apk dex: D4 ${own}`) && line.includes("references com.facebook.react.modules.network.NetworkingModule")),
        r.out,
      ).toBe(true);
    },
    TIMEOUT,
  );

  it("no production row names an R8 merged lambda class, whose name follows R8's choice", async () => {
    const lists = await loadProductionLists();
    const rows = lists.APK_NETWORK_ENTRY_POINTS as { id: string; classes: string[] }[];
    expect(rows.flatMap((r) => r.classes.filter((name) => name.includes("$$ExternalSynthetic")).map((name) => `${r.id} ${name}`))).toEqual([]);
  });
});
