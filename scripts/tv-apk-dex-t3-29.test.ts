// @vitest-environment node
// T3-29 items 1, 2 and 4 (docs/specs/T3-29.md, Test plan): the release APK's dex check (scripts/tv-apk-dex.mjs).
// - Item 1: D1's one-client exemption for S4 covers client-socket creation only. The S4 row of NETWORK_SINKS carries
//   `oneClientMethods` (java.net.Socket.<init>, javax.net.SocketFactory.createSocket); every other S4 class and method
//   in a one-client class fails D1, with the member in the line. The as-built DirectSocketFactory passes.
// - Item 2: D0 fails a dex whose R8 markers carry no pg-map-id, and a cut or damaged APK ends in one
//   `ERROR tv apk dex:` line that says to run pnpm tv:build, never a stack trace. The message of each D0 rule is held by
//   scripts/tv-apk-dex-d0-messages.test.ts, which no manifest freezes; this file pins only that it exists, is listed
//   in no manifest, and has one case per row of the spec's D0 table, titled `D0 row <n>: …` (n = 1 to 16, the row's
//   number in the table under "D0: the marker and the damaged APK").
// - Item 4: rule D8 fails an Octave module whose source declares a package outside dev.octave., read from
//   `system.repoRoot`, instead of judging its class as a library.
//
// Item 1's synthetic cases use the frozen harness's runDex on the release excerpt with one hand-written class appended
// (the dexClass pattern of tv-apk-dex-framework-sinks.test.ts). Item 2, item 4 and the as-built case run main through
// scripts/fixtures/tv/dex/t3-29/runner.ts.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemps, loadFixtureLists, runDex, type DexRun } from "./fixtures/tv/dex/harness";
import {
  cleanRunnerTemps,
  composeDump,
  composeMapping,
  dexBytes,
  DUMP_PREAMBLE,
  loadProductionLists,
  r8Marker,
  readFixture,
  repo,
  runRaw,
  stripHeader,
  tempDir,
  zip,
  type RawRun,
} from "./fixtures/tv/dex/t3-29/runner";

const TIMEOUT = 60_000;

afterAll(() => {
  cleanTemps();
  cleanRunnerTemps();
});

type Out = { code: number | null; out: string };
const errors = (run: Out) => run.out.split("\n").filter((line) => line.startsWith("ERROR tv apk dex:"));

// One dex class with one static method `a`, each instruction on its own source line; `superclass` is its declared one.
function dexClass(name: string, instructions: string[], superclass = "Ljava/lang/Object;"): string {
  const slashed = `L${name.replace(/\./g, "/")};`;
  return [
    "Class #9300            -",
    `  Class descriptor  : '${slashed}'`,
    "  Access flags      : 0x0011 (PUBLIC FINAL)",
    `  Superclass        : '${superclass}'`,
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

const section = (name: string, lines = 99) => [`${name} -> ${name}:`, `    1:${lines}:java.lang.Object run(java.lang.Object):1:${lines} -> a`].join("\n");

type Extra = { name: string; instructions: string[]; superclass?: string };

/** The release excerpt with `classes` appended, judged by the frozen fixture lists through the frozen runDex. */
async function judge(classes: Extra[]): Promise<DexRun> {
  const dump = composeDump() + classes.map((c) => dexClass(c.name, c.instructions, c.superclass)).join("");
  const mapping = [composeMapping(), ...classes.map((c) => section(c.name)), ""].join("\n");
  return runDex({ dump, mapping });
}

const DSF = "dev.octave.session.http.DirectSocketFactory";
const DSF_SUPER = "Ljavax/net/SocketFactory;";
const d1Lines = (run: Out, holder = DSF) => errors(run).filter((line) => line.includes(`D1 ${holder} holds S4`));

const slash = (name: string) => `L${name.replace(/\./g, "/")};`;

/** An instruction that invokes `cls.name`: invoke-direct for a constructor, invoke-static for open, else virtual. */
function invoke(cls: string, name: string): string {
  if (name === "<init>") return `invoke-direct {v0}, ${slash(cls)}.<init>:()V // method@0000`;
  if (name === "open") return `invoke-static {}, ${slash(cls)}.open:()${slash(cls)} // method@0000`;
  return `invoke-virtual {v0}, ${slash(cls)}.${name}:()Ljava/lang/Object; // method@0000`;
}

const SOCKET_INIT = "invoke-direct {v0, v1}, Ljava/net/Socket;.<init>:(Ljava/net/Proxy;)V // method@0000";
const OWN_CREATE_SOCKET = "invoke-virtual {v0}, Ldev/octave/session/http/DirectSocketFactory;.createSocket:()Ljava/net/Socket; // method@0000";

function expectD1For(run: Out, member: string, holder = DSF): void {
  expect(run.code, run.out).toBe(1);
  const lines = d1Lines(run, holder);
  expect(lines.length, run.out).toBeGreaterThan(0);
  expect(
    lines.some((line) => line.includes(member)),
    `a D1 line for ${holder} names ${member}:\n${run.out}`,
  ).toBe(true);
}

// --- item 1 ---------------------------------------------------------------------------------------------------

describe("T3-29 dex check: D1's one-client exemption covers client-socket creation only", () => {
  const NAMED: { member: string; instructions: string[] }[] = [
    { member: "java.net.ServerSocket.<init>", instructions: ["invoke-direct {v0, v1}, Ljava/net/ServerSocket;.<init>:(I)V // method@0000"] },
    { member: "java.net.DatagramSocket.<init>", instructions: ["invoke-direct {v0, v1}, Ljava/net/DatagramSocket;.<init>:(I)V // method@0000"] },
    {
      member: "java.nio.channels.ServerSocketChannel.open",
      instructions: ["invoke-static {}, Ljava/nio/channels/ServerSocketChannel;.open:()Ljava/nio/channels/ServerSocketChannel; // method@0000"],
    },
    {
      member: "javax.net.ServerSocketFactory.createServerSocket",
      instructions: ["invoke-virtual {v0, v1}, Ljavax/net/ServerSocketFactory;.createServerSocket:(I)Ljava/net/ServerSocket; // method@0000"],
    },
    {
      member: "java.nio.channels.spi.SelectorProvider.openServerSocketChannel",
      instructions: [
        "invoke-static {}, Ljava/nio/channels/spi/SelectorProvider;.provider:()Ljava/nio/channels/spi/SelectorProvider; // method@0000",
        "invoke-virtual {v0}, Ljava/nio/channels/spi/SelectorProvider;.openServerSocketChannel:()Ljava/nio/channels/ServerSocketChannel; // method@0000",
      ],
    },
    {
      member: "java.nio.channels.spi.SelectorProvider.openDatagramChannel",
      instructions: [
        "invoke-static {}, Ljava/nio/channels/spi/SelectorProvider;.provider:()Ljava/nio/channels/spi/SelectorProvider; // method@0000",
        "invoke-virtual {v0}, Ljava/nio/channels/spi/SelectorProvider;.openDatagramChannel:()Ljava/nio/channels/DatagramChannel; // method@0000",
      ],
    },
    {
      member: "java.nio.channels.spi.AsynchronousChannelProvider.openAsynchronousServerSocketChannel",
      instructions: [
        "invoke-virtual {v0, v1}, Ljava/nio/channels/spi/AsynchronousChannelProvider;.openAsynchronousServerSocketChannel:(Ljava/nio/channels/AsynchronousChannelGroup;)Ljava/nio/channels/AsynchronousServerSocketChannel; // method@0000",
      ],
    },
  ];

  for (const c of NAMED) {
    it(
      `T3-29 item 1: ${c.member} in DirectSocketFactory fails D1 and the line names the member`,
      async () => {
        const run = await judge([{ name: DSF, instructions: c.instructions, superclass: DSF_SUPER }]);
        expectD1For(run, c.member);
      },
      TIMEOUT,
    );
  }

  it(
    "T3-29 item 1: every S4 class and method that is not on oneClientMethods fails D1 in DirectSocketFactory, one line per member",
    async () => {
      const lists = await loadProductionLists();
      const sinks = lists.NETWORK_SINKS as { id: string; methods?: { classes: string[]; names: string[] }[]; oneClientMethods?: { classes: string[]; names: string[] }[] }[];
      const s4 = sinks.find((sink) => sink.id === "S4");
      expect(s4, "NETWORK_SINKS has an S4 row").toBeDefined();
      expect(Array.isArray(s4?.oneClientMethods), "the S4 row has a oneClientMethods list").toBe(true);
      const allowed = new Set((s4?.oneClientMethods ?? []).flatMap((m) => m.classes.flatMap((cls) => m.names.map((name) => `${cls}.${name}`))));
      expect([...allowed].sort()).toEqual(["java.net.Socket.<init>", "javax.net.SocketFactory.createSocket"]);
      const pairs = (s4?.methods ?? []).flatMap((m) => m.classes.flatMap((cls) => m.names.map((name) => ({ cls, name }))));
      const table = pairs.filter((p) => !allowed.has(`${p.cls}.${p.name}`));
      expect(table.length, "S4 lists members that are not client-socket creation").toBeGreaterThan(0);
      const run = await judge([{ name: DSF, instructions: table.map((p) => invoke(p.cls, p.name)), superclass: DSF_SUPER }]);
      expect(run.code, run.out).toBe(1);
      const lines = d1Lines(run);
      const missing = table.map((p) => `${p.cls}.${p.name}`).filter((member) => !lines.some((line) => line.includes(member)));
      expect(missing, run.out).toEqual([]);
    },
    TIMEOUT * 2,
  );

  it(
    "T3-29 item 1: createServerSocket invoked on an APK class that extends ServerSocketFactory (the superclass walk) fails D1 in DirectSocketFactory",
    async () => {
      const factory = "com.example.LanServerSocketFactory";
      const run = await judge([
        { name: DSF, instructions: ["invoke-virtual {v0, v1}, Lcom/example/LanServerSocketFactory;.createServerSocket:(I)Ljava/net/ServerSocket; // method@0000"], superclass: DSF_SUPER },
        { name: factory, instructions: ["return-object v0"], superclass: "Ljavax/net/ServerSocketFactory;" },
      ]);
      expectD1For(run, "createServerSocket");
    },
    TIMEOUT,
  );

  it(
    "T3-29 item 1: DirectSocketFactory constructing java.net.Socket and calling its own createSocket gives no D1 line",
    async () => {
      const run = await judge([{ name: DSF, instructions: [SOCKET_INIT, OWN_CREATE_SOCKET], superclass: DSF_SUPER }]);
      expect(d1Lines(run), run.out).toEqual([]);
      expect(errors(run), run.out).toEqual([]);
      expect(run.code, run.out).toBe(0);
    },
    TIMEOUT,
  );

  it(
    "T3-29 item 1: a client-socket allowed in DirectSocketFactory does not hide a listening socket next to it",
    async () => {
      const run = await judge([
        {
          name: DSF,
          instructions: [SOCKET_INIT, OWN_CREATE_SOCKET, "invoke-direct {v0, v1}, Ljava/net/ServerSocket;.<init>:(I)V // method@0000"],
          superclass: DSF_SUPER,
        },
      ]);
      expectD1For(run, "java.net.ServerSocket.<init>");
      expect(d1Lines(run).some((line) => line.includes("java.net.Socket.<init>") && !line.includes("java.net.ServerSocket.<init>")), run.out).toBe(false);
    },
    TIMEOUT,
  );

  it(
    "T3-29 item 1: the same client-socket instructions in dev.octave.tv.Other still fail D1 (the exemption is the class's)",
    async () => {
      const other = "dev.octave.tv.Other";
      const run = await judge([{ name: other, instructions: [SOCKET_INIT] }]);
      expect(run.code, run.out).toBe(1);
      expect(d1Lines(run, other).length, run.out).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    "T3-29 item 1: the as-built DirectSocketFactory, judged alone against its own build's mapping, passes",
    async () => {
      const dumpText = readFixture("direct-socket-factory.dump.txt");
      const mappingText = readFixture("direct-socket-factory.mapping.txt");
      expect(dumpText).toContain("Class descriptor");
      const id = /^# pg_map_id: ([0-9a-f]+)$/m.exec(mappingText)?.[1];
      expect(id, "the fixture mapping has its build's pg_map_id").toBeDefined();
      expect(mappingText).toMatch(/^dev\.octave\.session\.http\.DirectSocketFactory -> /m);
      const lists = await loadProductionLists();
      const run = await runRaw({
        apk: zip([{ name: "classes.dex", data: dexBytes(r8Marker(id)), deflate: true }]),
        mapping: mappingText,
        dump: DUMP_PREAMBLE + stripHeader(dumpText),
        lists: {
          sinks: lists.NETWORK_SINKS,
          libraryInternal: lists.LIBRARY_INTERNAL,
          oneClient: lists.ONE_CLIENT_CLASSES,
          hooks: lists.ENTRY_POINT_HOOKS,
          entryPoints: [],
          devSupportCallers: [],
          absentPackages: [],
        },
      });
      expect(run.threw, run.out).toBeUndefined();
      expect(errors(run), run.out).toEqual([]);
      expect(run.code, run.out).toBe(0);
    },
    TIMEOUT,
  );
});

// --- item 2 ---------------------------------------------------------------------------------------------------

const NO_ID_MARKER = '~~R8{"backend":"dex","compilation-mode":"release","min-api":24,"version":"9.2.14"}';
const OTHER_ID = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/** The frozen fixture lists, as runDex judges with them. */
async function fixtureLists(): Promise<Record<string, unknown>> {
  return { ...(await loadFixtureLists()).FIXTURE_LISTS };
}

const goodEntries = () => [
  { name: "AndroidManifest.xml", data: Buffer.from("not read by the dex check") },
  { name: "classes.dex", data: dexBytes(), deflate: true },
];

/** The central directory entries of a zip the harness wrote: { name, at } with `at` the header's offset. */
function centrals(buf: Buffer): { end: number; dir: number; entries: { name: string; at: number }[] } {
  const end = buf.length - 22;
  expect(buf.readUInt32LE(end)).toBe(0x06054b50);
  const count = buf.readUInt16LE(end + 10);
  const dir = buf.readUInt32LE(end + 16);
  const entries: { name: string; at: number }[] = [];
  let at = dir;
  for (let n = 0; n < count; n += 1) {
    const nameLength = buf.readUInt16LE(at + 28);
    entries.push({ name: buf.toString("utf8", at + 46, at + 46 + nameLength), at });
    at += 46 + nameLength + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return { end, dir, entries };
}

const centralOf = (buf: Buffer, name: string) => {
  const found = centrals(buf).entries.find((e) => e.name === name);
  if (!found) throw new Error(`no ${name} in the zip`);
  return found.at;
};

const DAMAGED: { name: string; apk: () => Buffer }[] = [
  {
    name: "the last 12 bytes cut (no end record)",
    apk: () => {
      const whole = zip(goodEntries());
      return whole.subarray(0, whole.length - 12);
    },
  },
  {
    name: "cut in the middle of the central directory, with a valid end record appended",
    apk: () => {
      const whole = zip(goodEntries());
      const { end, dir } = centrals(whole);
      return Buffer.concat([whole.subarray(0, dir + 20), whole.subarray(end)]);
    },
  },
  {
    name: "a central header whose local offset points past the file",
    apk: () => {
      const whole = Buffer.from(zip(goodEntries()));
      whole.writeUInt32LE(whole.length + 4096, centralOf(whole, "classes.dex") + 42);
      return whole;
    },
  },
  {
    name: "a stored classes.dex whose size field is larger than the bytes left",
    apk: () => {
      const whole = Buffer.from(zip([{ name: "AndroidManifest.xml", data: Buffer.from("not read") }, { name: "classes.dex", data: dexBytes() }]));
      const at = centralOf(whole, "classes.dex");
      const size = whole.readUInt32LE(at + 20) + whole.length + 4096;
      whole.writeUInt32LE(size, at + 20);
      whole.writeUInt32LE(size, at + 24);
      return whole;
    },
  },
  {
    name: "a deflated classes.dex with its body cut in half",
    apk: () => {
      // A stored entry holding half of the deflated body, then marked deflated: its sizes say half was written and the
      // whole dex inflates from it, which it cannot.
      const data = dexBytes();
      const body = deflateRawSync(data);
      const half = body.subarray(0, Math.floor(body.length / 2));
      const whole = Buffer.from(zip([{ name: "AndroidManifest.xml", data: Buffer.from("not read") }, { name: "classes.dex", data: half }]));
      const at = centralOf(whole, "classes.dex");
      const local = whole.readUInt32LE(at + 42);
      whole.writeUInt16LE(8, at + 10);
      whole.writeUInt16LE(8, local + 8);
      whole.writeUInt32LE(data.length, at + 24);
      whole.writeUInt32LE(data.length, local + 22);
      return whole;
    },
  },
];

function expectOneRebuildLine(run: RawRun): void {
  expect(run.threw, `main threw: ${String(run.threw)}\n${run.out}`).toBeUndefined();
  expect(run.code, run.out).toBe(1);
  const lines = errors(run);
  expect(lines.length, run.out).toBe(1);
  expect(lines[0], run.out).toContain("truncated or damaged");
  expect(lines[0], run.out).toContain("pnpm tv:build");
  expect(run.out).not.toContain("RangeError");
  expect(run.out.split("\n").some((line) => /^\s+at /.test(line)), run.out).toBe(false);
}

describe("T3-29 dex check: D0 on the R8 marker and on a damaged APK", () => {
  it(
    "T3-29 item 2: an R8 marker with no pg-map-id fails D0",
    async () => {
      const run = await runDex({ apkEntries: [{ name: "classes.dex", data: dexBytes(NO_ID_MARKER), deflate: true }] });
      expect(run.code, run.out).toBe(1);
      expect(errors(run).some((line) => line.includes("has an R8 marker but no pg-map-id")), run.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "T3-29 item 2: an R8 marker with no pg-map-id fails D0 whatever id the mapping has",
    async () => {
      const replaced = composeMapping().replace(/^# pg_map_id: [0-9a-f]+$/m, `# pg_map_id: ${OTHER_ID}`);
      expect(replaced).toContain(OTHER_ID);
      const run = await runDex({ apkEntries: [{ name: "classes.dex", data: dexBytes(NO_ID_MARKER), deflate: true }], mapping: replaced });
      expect(run.code, run.out).toBe(1);
      expect(errors(run).some((line) => line.includes("has an R8 marker but no pg-map-id")), run.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "T3-29 item 2: a dex with two R8 markers, one carrying the right pg-map-id, has no such line",
    async () => {
      const data = Buffer.concat([dexBytes(NO_ID_MARKER), dexBytes(r8Marker())]);
      const run = await runDex({ apkEntries: [{ name: "classes.dex", data, deflate: true }] });
      expect(errors(run).some((line) => line.includes("has an R8 marker but no pg-map-id")), run.out).toBe(false);
      expect(run.code, run.out).toBe(0);
    },
    TIMEOUT,
  );

  for (const c of DAMAGED) {
    it(
      `T3-29 item 2: ${c.name} ends in one ERROR line that says to rebuild, not a stack trace`,
      async () => {
        const run = await runRaw({
          apk: c.apk(),
          mapping: composeMapping(),
          dump: composeDump().split("apps/tv/android/app/build/outputs/apk/release/app-release.apk").join("{apk}"),
          lists: await fixtureLists(),
        });
        expectOneRebuildLine(run);
      },
      TIMEOUT,
    );
  }

  it("T3-29 item 2: scripts/tv-apk-dex-d0-messages.test.ts exists, is in no manifest, and has a case per row of the D0 table", () => {
    const path = "scripts/tv-apk-dex-d0-messages.test.ts";
    expect(existsSync(join(repo, path)), `${path} exists`).toBe(true);
    const specs = join(repo, "docs", "specs");
    const listing = readdirSync(specs)
      .filter((name) => name.endsWith(".tests.json"))
      .filter((name) => {
        const manifest = JSON.parse(readFileSync(join(specs, name), "utf8")) as { files?: string[] };
        return (manifest.files ?? []).includes(path);
      });
    expect(listing, `manifests that list ${path}`).toEqual([]);
    const text = readFileSync(join(repo, path), "utf8");
    const titled = Array.from({ length: 16 }, (_, i) => i + 1).filter((n) => new RegExp(`\\bit\\s*\\(\\s*["'\`]D0 row ${n}: `).test(text));
    expect(titled, "an it(\"D0 row <n>: …\") case for each of rows 1 to 16").toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });
});

// --- item 4 ---------------------------------------------------------------------------------------------------

/** A temp repository root with one module, `modules/lan`, whose Kotlin file and namespace are in `pkg`. */
function moduleRoot(pkg: string): { root: string; file: string } {
  const root = tempDir("octave-t3-29-root-");
  const file = join("modules", "lan", "android", "src", "main", "java", ...pkg.split("."), "LanModule.kt");
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), `package ${pkg}\n\nclass LanModule {\n  fun listen() = java.net.ServerSocket(0)\n}\n`);
  writeFileSync(join(root, "modules", "lan", "android", "build.gradle"), `android {\n  namespace "${pkg}"\n}\n`);
  return { root, file };
}

const LAN_LISTEN = "invoke-direct {v0, v1}, Ljava/net/ServerSocket;.<init>:(I)V // method@0000";

async function runModule(root: string, holder: string, row: boolean): Promise<RawRun> {
  const lists = await fixtureLists();
  if (row) {
    lists.entryPoints = [
      ...(lists.entryPoints as unknown[]),
      { id: "FX9", classes: [holder], sinks: ["S4"], what: "a test module's listening socket", reason: "Fixture row.", linkedPath: null },
    ];
  }
  return runRaw({
    apk: zip(goodEntries()),
    mapping: [composeMapping(), section(holder), ""].join("\n"),
    dump: (composeDump() + dexClass(holder, [LAN_LISTEN])).split("apps/tv/android/app/build/outputs/apk/release/app-release.apk").join("{apk}"),
    lists,
    repoRoot: root,
  });
}

describe("T3-29 dex check: rule D8, Octave's modules sit in dev.octave.", () => {
  it(
    "T3-29 item 4: a module in com.example.lan whose class holds a socket and has an entry-point row fails D8 by file name instead of passing D2",
    async () => {
      const { root, file } = moduleRoot("com.example.lan");
      const run = await runModule(root, "com.example.lan.LanModule", true);
      expect(run.threw, String(run.threw)).toBeUndefined();
      expect(run.code, run.out).toBe(1);
      const d8 = errors(run).filter((line) => /\bD8\b/.test(line));
      expect(
        d8.some((line) => line.includes(file) && line.includes("com.example.lan")),
        `a D8 line names ${file} and com.example.lan:\n${run.out}`,
      ).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "T3-29 item 4: the same module in dev.octave.lan has no D8 line, and its socket fails D1",
    async () => {
      const { root } = moduleRoot("dev.octave.lan");
      const run = await runModule(root, "dev.octave.lan.LanModule", false);
      expect(run.threw, String(run.threw)).toBeUndefined();
      expect(errors(run).filter((line) => /\bD8\b/.test(line)), run.out).toEqual([]);
      expect(run.code, run.out).toBe(1);
      expect(errors(run).some((line) => line.includes("D1 dev.octave.lan.LanModule holds S4")), run.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "T3-29 item 4: a root that holds no module source fails closed",
    async () => {
      const root = tempDir("octave-t3-29-empty-");
      const run = await runRaw({
        apk: zip(goodEntries()),
        mapping: composeMapping(),
        dump: composeDump().split("apps/tv/android/app/build/outputs/apk/release/app-release.apk").join("{apk}"),
        lists: await fixtureLists(),
        repoRoot: root,
      });
      expect(run.threw, String(run.threw)).toBeUndefined();
      expect(run.code, run.out).toBe(1);
      expect(errors(run).length, run.out).toBeGreaterThan(0);
    },
    TIMEOUT,
  );
});
