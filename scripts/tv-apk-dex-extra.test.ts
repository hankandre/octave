// @vitest-environment node
// T3-19, decision log 14 (not frozen): Octave's invoke of Call$Factory.newCall is not a sink, but only for a factory
// Octave's own code hands out. An Octave method that takes a Call$Factory from a class outside dev.octave. fails (D1);
// an Octave invoke on WebSocket$Factory fails; the same newCall in library code inlined into an Octave method fails.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemps, composeDump, composeMapping, FIXTURES, runDex, type DexRun } from "./fixtures/tv/dex/harness";

const TIMEOUT = 60_000;
afterAll(() => cleanTemps());

const errors = (run: DexRun) => run.out.split("\n").filter((line) => line.startsWith("ERROR tv apk dex:"));

// The sender-one-client mapping sections (OctaveHttp, Call$Factory as zz8, Call as il) without their # header.
const senderMapping = readFileSync(join(FIXTURES, "extra", "sender-one-client.mapping.txt"), "utf8")
  .split("\n")
  .filter((line) => !line.startsWith("#"))
  .join("\n");

function method(dexClass: string, instructions: string[]): string {
  const slashed = `L${dexClass.replace(/\./g, "/")};`;
  return [
    "Class #9100            -",
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
    `7f0000:                                        |[7f0000] ${dexClass}.a:(Ljava/lang/Object;)Ljava/lang/Object;`,
    ...instructions.map((text, i) => `7f00${(16 + i * 6).toString(16)}: 0000                                   |${(i * 3).toString(16).padStart(4, "0")}: ${text}`),
    "      catches       : (none)",
    "      positions     :",
    ...instructions.map((_, i) => `        0x${(i * 3).toString(16).padStart(4, "0")} line=${i + 1}`),
    "      locals        :",
    "",
    "  Virtual methods   -",
    "",
  ].join("\n");
}

const CALL_NEW_CALL = "invoke-interface {v0, v1}, Lzz8;.a:(Lf9;)Lil; // method@0000";

describe("T3-19 decision log 14: where Octave may take a call factory", () => {
  it(
    "an Octave method that reads a Call$Factory from a com.example getter and sends with it fails D1",
    async () => {
      const dump = composeDump() + method("dev.octave.tv.Taker", ["invoke-static {v1}, Lcom/example/Factories;.a:()Lzz8; // method@0000", CALL_NEW_CALL]);
      const mapping = [
        composeMapping(),
        senderMapping,
        "com.example.Factories -> com.example.Factories:",
        "    1:2:okhttp3.Call$Factory factory():3:3 -> a",
        "dev.octave.tv.Taker -> dev.octave.tv.Taker:",
        "    1:2:java.lang.Object take(java.lang.Object):9:9 -> a",
        "",
      ].join("\n");
      const run = await runDex({ dump, mapping });
      expect(run.code, run.out).toBe(1);
      expect(errors(run).some((line) => line.includes("D1") && line.includes("dev.octave.tv.Taker") && line.includes("com.example.Factories")), run.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "an Octave field read of a Call$Factory held by a com.example class fails D1",
    async () => {
      const dump = composeDump() + method("dev.octave.tv.Taker", ["sget-object v0, Lcom/example/Holder;.a:Lzz8; // field@0000", CALL_NEW_CALL]);
      const mapping = [
        composeMapping(),
        senderMapping,
        "com.example.Holder -> com.example.Holder:",
        "    okhttp3.Call$Factory factory -> a",
        "dev.octave.tv.Taker -> dev.octave.tv.Taker:",
        "    1:2:java.lang.Object take(java.lang.Object):9:9 -> a",
        "",
      ].join("\n");
      const run = await runDex({ dump, mapping });
      expect(run.code, run.out).toBe(1);
      expect(errors(run).some((line) => line.includes("D1") && line.includes("com.example.Holder")), run.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "an Octave invoke on WebSocket$Factory fails D1",
    async () => {
      const dump = composeDump() + method("dev.octave.tv.Taker", ["invoke-interface {v0, v1}, Lws9;.a:(Lf9;Lbu2;)Lta2; // method@0000"]);
      const mapping = [
        composeMapping(),
        "dev.octave.tv.Taker -> dev.octave.tv.Taker:",
        "    1:2:java.lang.Object take(java.lang.Object):9:9 -> a",
        "okhttp3.WebSocket$Factory -> ws9:",
        "    okhttp3.WebSocket newWebSocket(okhttp3.Request,okhttp3.WebSocketListener) -> a",
        "",
      ].join("\n");
      const run = await runDex({ dump, mapping });
      expect(run.code, run.out).toBe(1);
      expect(errors(run).some((line) => line.includes("D1") && line.includes("dev.octave.tv.Taker")), run.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "a library's newCall inlined into an Octave method is not exempt",
    async () => {
      const dump = composeDump() + method("dev.octave.tv.Taker", [CALL_NEW_CALL]);
      const mapping = [
        composeMapping(),
        senderMapping,
        "dev.octave.tv.Taker -> dev.octave.tv.Taker:",
        "    1:2:void com.example.Lib.send(okhttp3.Call$Factory):4:4 -> a",
        "    1:2:java.lang.Object take(java.lang.Object):9 -> a",
        "",
      ].join("\n");
      const run = await runDex({ dump, mapping });
      expect(run.code, run.out).toBe(1);
      expect(errors(run).some((line) => line.includes("D1") && line.includes("dev.octave.tv.Taker")), run.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "the frozen sender-one-client sample still passes",
    async () => {
      const run = await runDex({ dump: composeDump(["sender-one-client"]), mapping: composeMapping(["sender-one-client"]) });
      expect(errors(run), run.out).toEqual([]);
      expect(run.code).toBe(0);
    },
    TIMEOUT,
  );
});

// Decision log 22: each dev.octave. frame makes one reference. The innermost remaining frame references the operand;
// an Octave frame further out references the next-inner frame, the callee R8 inlined into it.
const TAKER_OUTER = "    1:2:java.lang.Object take(java.lang.Object):9 -> a";
const takerMapping = (...inner: string[]) =>
  [composeMapping(), "dev.octave.tv.Taker -> dev.octave.tv.Taker:", ...inner.map((line) => `    1:2:${line} -> a`), TAKER_OUTER, ""].join("\n");
const NETWORKING = "Lcom/facebook/react/modules/network/NetworkingModule;";
const NO_SINK = "invoke-static {v0}, Ljava/util/Objects;.requireNonNull:(Ljava/lang/Object;)Ljava/lang/Object; // method@0000";

describe("T3-19 decision log 22: D4 judges the reference Octave's own source makes", () => {
  it(
    "library code inlined into an Octave method whose operand names a listed class does not fail D4",
    async () => {
      const dump = composeDump() + method("dev.octave.tv.Taker", [`new-instance v0, ${NETWORKING} // type@0000`]);
      const run = await runDex({ dump, mapping: takerMapping("java.lang.Object com.example.Lib.build():4:4") });
      expect(errors(run), run.out).toEqual([]);
      expect(run.code).toBe(0);
    },
    TIMEOUT,
  );

  it.each([
    ["a hook's", "com.facebook.react.modules.network.OkHttpClientProvider", "void com.facebook.react.modules.network.OkHttpClientProvider.setOkHttpClientFactory(com.facebook.react.modules.network.OkHttpClientFactory):50:50"],
    ["a listed class's", "com.facebook.react.modules.network.NetworkingModule", "void com.facebook.react.modules.network.NetworkingModule.clearCookies(com.facebook.react.bridge.Callback):70:70"],
  ])(
    "%s method inlined directly into an Octave method, with no sink and no operand naming the class, fails D4",
    async (_kind, listed, frame) => {
      const dump = composeDump() + method("dev.octave.tv.Taker", [NO_SINK]);
      const run = await runDex({ dump, mapping: takerMapping(frame) });
      expect(run.code, run.out).toBe(1);
      expect(errors(run).some((line) => line.includes("D4 dev.octave.tv.Taker references") && line.includes(listed)), run.out).toBe(true);
      expect(errors(run).every((line) => line.includes("D4")), run.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "the same listed frame with an unlisted library frame between it and the Octave frame does not fail D4",
    async () => {
      const dump = composeDump() + method("dev.octave.tv.Taker", [NO_SINK]);
      const run = await runDex({
        dump,
        mapping: takerMapping(
          "void com.facebook.react.modules.network.OkHttpClientProvider.setOkHttpClientFactory(com.facebook.react.modules.network.OkHttpClientFactory):50:50",
          "void com.example.Lib.configure():7",
        ),
      });
      expect(errors(run), run.out).toEqual([]);
      expect(run.code).toBe(0);
    },
    TIMEOUT,
  );

  it(
    "a sink in library code inlined into an Octave method still fails D1",
    async () => {
      const dump = composeDump() + method("dev.octave.tv.Taker", ["invoke-virtual {v0}, Ljava/net/URL;.openConnection:()Ljava/net/URLConnection; // method@0000"]);
      const run = await runDex({ dump, mapping: takerMapping("java.lang.Object com.example.Lib.fetch(java.net.URL):4:4") });
      expect(run.code, run.out).toBe(1);
      expect(errors(run).some((line) => line.includes("D1 dev.octave.tv.Taker holds S2")), run.out).toBe(true);
    },
    TIMEOUT,
  );
});
