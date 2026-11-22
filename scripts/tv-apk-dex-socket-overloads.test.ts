// @vitest-environment node
// T3-29 review fix (not frozen): D1's one-client exemption for java.net.Socket.<init> covers only the overloads on the
// S4 row's `oneClientMethods` descriptors, Socket(Proxy) as DirectSocketFactory builds it. Socket(String, int, boolean)
// and Socket(InetAddress, int, boolean) make a datagram socket when the flag is false, and Socket(SocketImpl) takes any
// implementation (android.jar 37.1, javap); each fails D1 in DirectSocketFactory with the overload in the line.
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemps, composeDump, composeMapping, runDex, type DexRun } from "./fixtures/tv/dex/harness";
import { NETWORK_SINKS } from "./tv-apk-dex-lists.mjs";

const TIMEOUT = 60_000;
afterAll(() => cleanTemps());

const DSF = "dev.octave.session.http.DirectSocketFactory";
const errors = (run: DexRun) => run.out.split("\n").filter((line) => line.startsWith("ERROR tv apk dex:"));
const d1Lines = (run: DexRun) => errors(run).filter((line) => line.includes(`D1 ${DSF} holds S4`));

function dexClass(name: string, instructions: string[]): string {
  const slashed = `L${name.replace(/\./g, "/")};`;
  return [
    "Class #9400            -",
    `  Class descriptor  : '${slashed}'`,
    "  Access flags      : 0x0011 (PUBLIC FINAL)",
    "  Superclass        : 'Ljavax/net/SocketFactory;'",
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

/** The release excerpt with DirectSocketFactory's method `a` appended, judged by the production sink lists. */
function judge(instructions: string[]): Promise<DexRun> {
  const dump = composeDump() + dexClass(DSF, instructions);
  const mapping = [composeMapping(), `${DSF} -> ${DSF}:`, "    1:99:java.lang.Object run(java.lang.Object):1:99 -> a", ""].join("\n");
  return runDex({ dump, mapping });
}

const init = (params: string) => `invoke-direct {v0, v1, v2, v3}, Ljava/net/Socket;.<init>:${params}V // method@0000`;
const PROXY = init("(Ljava/net/Proxy;)");

describe("T3-29 review fix: D1 exempts only the java.net.Socket constructors DirectSocketFactory uses", () => {
  it("the S4 row lists Socket(Proxy) as the only exempt Socket constructor", () => {
    const s4 = NETWORK_SINKS.find((sink) => sink.id === "S4");
    const socket = s4?.oneClientMethods?.find((m) => m.classes.includes("java.net.Socket"));
    expect(socket?.descriptors).toEqual(["(Ljava/net/Proxy;)"]);
  });

  for (const params of ["(Ljava/lang/String;IZ)", "(Ljava/net/InetAddress;IZ)", "(Ljava/net/SocketImpl;)", "()"]) {
    it(
      `Socket${params}V in DirectSocketFactory fails D1 and the line names the overload`,
      async () => {
        const run = await judge([init(params)]);
        expect(run.code, run.out).toBe(1);
        const lines = d1Lines(run);
        expect(lines.some((line) => line.includes(`java.net.Socket.<init>${params} is not what the one client may do of S4`)), run.out).toBe(true);
        expect(lines.some((line) => line.includes("may call only java.net.Socket.<init>(Ljava/net/Proxy;) and javax.net.SocketFactory.createSocket")), run.out).toBe(true);
      },
      TIMEOUT,
    );
  }

  it(
    "Socket(Proxy) in DirectSocketFactory gives no D1 line",
    async () => {
      const run = await judge([PROXY]);
      expect(errors(run), run.out).toEqual([]);
      expect(run.code, run.out).toBe(0);
    },
    TIMEOUT,
  );

  it(
    "a boolean overload after an exempt Socket(Proxy) in the same method still fails D1",
    async () => {
      const run = await judge([PROXY, init("(Ljava/lang/String;IZ)")]);
      expect(run.code, run.out).toBe(1);
      expect(d1Lines(run).some((line) => line.includes("java.net.Socket.<init>(Ljava/lang/String;IZ)")), run.out).toBe(true);
    },
    TIMEOUT,
  );
});
