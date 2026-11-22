// @vitest-environment node
// T3-19 review fix (not frozen): framework APIs that open a connection without naming a sink the first lists named.
// (a) SelectorProvider's and AsynchronousChannelProvider's channel opens, a listening ServerSocketChannel among them;
// (b) MediaPlayer.create; (c) MediaExtractor.setDataSource and MediaMetadataRetriever.setDataSource, except the
//     overloads that read only an open file or the app's own MediaDataSource;
// (d) a sink method invoked on a framework subclass (android.net.SSLCertificateSocketFactory.createSocket), directly or
//     through a class the APK declares, walked through FRAMEWORK_SUPERCLASSES (android.jar 37.1, javap).
// Each case fails D2 in a class no row covers and D1 in Octave's code; SelectorProvider.openSelector, which opens no
// connection, stays a pass.
import { afterAll, describe, expect, it } from "vitest";
import { cleanTemps, composeDump, composeMapping, runDex, type DexRun } from "./fixtures/tv/dex/harness";

const TIMEOUT = 60_000;
afterAll(() => cleanTemps());

const errors = (run: DexRun) => run.out.split("\n").filter((line) => line.startsWith("ERROR tv apk dex:"));

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

const section = (name: string) => [`${name} -> ${name}:`, "    1:9:java.lang.Object run(java.lang.Object):1:9 -> a"].join("\n");

async function judge(holder: string, instructions: string[], extra: { dump?: string; mapping?: string[] } = {}): Promise<DexRun> {
  const dump = composeDump() + dexClass(holder, instructions) + (extra.dump ?? "");
  const mapping = [composeMapping(), section(holder), ...(extra.mapping ?? []), ""].join("\n");
  return runDex({ dump, mapping });
}

const LIBRARY = "com.example.Listener";
const OCTAVE = "dev.octave.tv.Listener";

const PROVIDER = "invoke-static {}, Ljava/nio/channels/spi/SelectorProvider;.provider:()Ljava/nio/channels/spi/SelectorProvider; // method@0000";
const OPEN_SERVER = "invoke-virtual {v0}, Ljava/nio/channels/spi/SelectorProvider;.openServerSocketChannel:()Ljava/nio/channels/ServerSocketChannel; // method@0000";

const CASES: { name: string; sink: string; instructions: string[] }[] = [
  { name: "(a) SelectorProvider.openServerSocketChannel, a listening channel", sink: "S4", instructions: [PROVIDER, OPEN_SERVER] },
  {
    name: "(a) SelectorProvider.openSocketChannel",
    sink: "S4",
    instructions: [PROVIDER, "invoke-virtual {v0}, Ljava/nio/channels/spi/SelectorProvider;.openSocketChannel:()Ljava/nio/channels/SocketChannel; // method@0000"],
  },
  {
    name: "(a) SelectorProvider.openDatagramChannel",
    sink: "S4",
    instructions: [PROVIDER, "invoke-virtual {v0}, Ljava/nio/channels/spi/SelectorProvider;.openDatagramChannel:()Ljava/nio/channels/DatagramChannel; // method@0000"],
  },
  {
    name: "(a) AsynchronousChannelProvider.openAsynchronousServerSocketChannel",
    sink: "S4",
    instructions: [
      "invoke-virtual {v0, v1}, Ljava/nio/channels/spi/AsynchronousChannelProvider;.openAsynchronousServerSocketChannel:(Ljava/nio/channels/AsynchronousChannelGroup;)Ljava/nio/channels/AsynchronousServerSocketChannel; // method@0000",
    ],
  },
  {
    name: "(b) MediaPlayer.create(Context, Uri)",
    sink: "S6",
    instructions: ["invoke-static {v0, v1}, Landroid/media/MediaPlayer;.create:(Landroid/content/Context;Landroid/net/Uri;)Landroid/media/MediaPlayer; // method@0000"],
  },
  {
    name: "(c) MediaExtractor.setDataSource(String, Map)",
    sink: "S6",
    instructions: ["invoke-virtual {v0, v1, v2}, Landroid/media/MediaExtractor;.setDataSource:(Ljava/lang/String;Ljava/util/Map;)V // method@0000"],
  },
  {
    name: "(c) MediaMetadataRetriever.setDataSource(String, Map)",
    sink: "S6",
    instructions: ["invoke-virtual {v0, v1, v2}, Landroid/media/MediaMetadataRetriever;.setDataSource:(Ljava/lang/String;Ljava/util/Map;)V // method@0000"],
  },
  {
    name: "(d) SSLCertificateSocketFactory.createSocket(host, port), a framework subclass of SocketFactory",
    sink: "S4",
    instructions: ["invoke-virtual {v0, v1, v2}, Landroid/net/SSLCertificateSocketFactory;.createSocket:(Ljava/lang/String;I)Ljava/net/Socket; // method@0000"],
  },
  {
    name: "(d) the protected SSLSocket constructor a subclass calls",
    sink: "S4",
    instructions: ["invoke-direct {v0, v1, v2}, Ljavax/net/ssl/SSLSocket;.<init>:(Ljava/lang/String;I)V // method@0000"],
  },
];

describe("T3-19 review fix: framework APIs that open a connection are sinks", () => {
  for (const c of CASES) {
    it(
      `${c.name} in a class no row covers fails D2 as ${c.sink}`,
      async () => {
        const run = await judge(LIBRARY, c.instructions);
        expect(run.code, run.out).toBe(1);
        expect(errors(run).some((line) => line.includes(`D2 ${LIBRARY} holds ${c.sink}`)), run.out).toBe(true);
      },
      TIMEOUT,
    );
    it(
      `${c.name} in Octave's code fails D1 as ${c.sink}`,
      async () => {
        const run = await judge(OCTAVE, c.instructions);
        expect(run.code, run.out).toBe(1);
        expect(errors(run).some((line) => line.includes(`D1 ${OCTAVE} holds ${c.sink}`)), run.out).toBe(true);
      },
      TIMEOUT,
    );
  }

  it(
    "(d) createSocket invoked on an APK class that extends SSLCertificateSocketFactory fails D2 as S4",
    async () => {
      const factory = "com.example.LanSocketFactory";
      const run = await judge(LIBRARY, ["invoke-virtual {v0, v1, v2}, Lcom/example/LanSocketFactory;.createSocket:(Ljava/lang/String;I)Ljava/net/Socket; // method@0000"], {
        dump: dexClass(factory, ["return-object v0"], "Landroid/net/SSLCertificateSocketFactory;"),
        mapping: [section(factory)],
      });
      expect(run.code, run.out).toBe(1);
      expect(errors(run).some((line) => line.includes(`D2 ${LIBRARY} holds S4`)), run.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "(c) setDataSource(String, Map) invoked on an APK class that extends MediaMetadataRetriever fails D2 as S6",
    async () => {
      const retriever = "com.example.Retriever";
      const run = await judge(LIBRARY, ["invoke-virtual {v0, v1, v2}, Lcom/example/Retriever;.setDataSource:(Ljava/lang/String;Ljava/util/Map;)V // method@0000"], {
        dump: dexClass(retriever, ["return-object v0"], "Landroid/media/MediaMetadataRetriever;"),
        mapping: [section(retriever)],
      });
      expect(run.code, run.out).toBe(1);
      expect(errors(run).some((line) => line.includes(`D2 ${LIBRARY} holds S6`)), run.out).toBe(true);
    },
    TIMEOUT,
  );

  for (const [label, descriptor] of [
    ["MediaMetadataRetriever.setDataSource(String)", "Landroid/media/MediaMetadataRetriever;.setDataSource:(Ljava/lang/String;)V"],
    ["MediaMetadataRetriever.setDataSource(Context, Uri)", "Landroid/media/MediaMetadataRetriever;.setDataSource:(Landroid/content/Context;Landroid/net/Uri;)V"],
    ["MediaExtractor.setDataSource(Context, Uri, Map)", "Landroid/media/MediaExtractor;.setDataSource:(Landroid/content/Context;Landroid/net/Uri;Ljava/util/Map;)V"],
  ]) {
    it(
      `(c) ${label}, which can name a URL, fails D2 as S6`,
      async () => {
        const run = await judge(LIBRARY, [`invoke-virtual {v0, v1}, ${descriptor} // method@0000`]);
        expect(run.code, run.out).toBe(1);
        expect(errors(run).some((line) => line.includes(`D2 ${LIBRARY} holds S6`)), run.out).toBe(true);
      },
      TIMEOUT,
    );
  }

  for (const [label, descriptor] of [
    ["MediaMetadataRetriever.setDataSource(FileDescriptor), as Fresco's LocalVideoThumbnailProducer calls it", "Landroid/media/MediaMetadataRetriever;.setDataSource:(Ljava/io/FileDescriptor;)V"],
    ["MediaExtractor.setDataSource(FileDescriptor, long, long)", "Landroid/media/MediaExtractor;.setDataSource:(Ljava/io/FileDescriptor;JJ)V"],
    ["MediaExtractor.setDataSource(AssetFileDescriptor)", "Landroid/media/MediaExtractor;.setDataSource:(Landroid/content/res/AssetFileDescriptor;)V"],
    ["MediaMetadataRetriever.setDataSource(MediaDataSource)", "Landroid/media/MediaMetadataRetriever;.setDataSource:(Landroid/media/MediaDataSource;)V"],
  ]) {
    it(
      `(c) ${label}, which reads only an open file or the app's own source, passes`,
      async () => {
        const run = await judge(LIBRARY, [`invoke-virtual {v0, v1}, ${descriptor} // method@0000`]);
        expect(errors(run), run.out).toEqual([]);
        expect(run.code, run.out).toBe(0);
      },
      TIMEOUT,
    );
  }

  it(
    "MediaPlayer.setDataSource(FileDescriptor) stays a sink: its committed entry is name-only",
    async () => {
      const run = await judge(LIBRARY, ["invoke-virtual {v0, v1}, Landroid/media/MediaPlayer;.setDataSource:(Ljava/io/FileDescriptor;)V // method@0000"]);
      expect(run.code, run.out).toBe(1);
      expect(errors(run).some((line) => line.includes(`D2 ${LIBRARY} holds S6`)), run.out).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "SelectorProvider.openSelector, which opens no connection, passes",
    async () => {
      const run = await judge(LIBRARY, [PROVIDER, "invoke-virtual {v0}, Ljava/nio/channels/spi/SelectorProvider;.openSelector:()Ljava/nio/channels/spi/AbstractSelector; // method@0000"]);
      expect(errors(run), run.out).toEqual([]);
      expect(run.code, run.out).toBe(0);
    },
    TIMEOUT,
  );
});
