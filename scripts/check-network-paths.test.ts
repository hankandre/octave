// @vitest-environment node
// T3-04 items 1, 2, 4 and 5: `pnpm lint:network` (scripts/check-network-paths.mjs) fails Kotlin and Java source that
// opens a network path around the one authenticated client, and every message names the allowed alternative.
//
// The interface these frozen tests hold (spec, Approach "Shape"; spec check issue 5):
// - KOTLIN_RULES: { id: "K1".."K10", alternative: string, ... }[]; the ids are exactly K1 to K10.
// - findSourceViolations(files: { path, text }[]): string[], each line `ERROR network: <path>:<line>: <what>. <alternative>`,
//   with <path> as given. A path under apps/tv/plugins/ is read as plain JavaScript text (distinctive type names only).
// - The command takes `--root <dir>` (default: the repository) and reads the trees relative to it; an ERROR line names
//   the file relative to that root, with forward slashes. It prints `network: N Octave files, M linked files, 0 violations`
//   when it passes.
//
// The module does not exist before implementation, so it is loaded at run time from a path built here and
// `pnpm typecheck` does not depend on it (the pattern of scripts/tv-host.test.ts).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(repo, "scripts", "check-network-paths.mjs");
const TIMEOUT = 120_000;

type SourceFile = { path: string; text: string };
type KotlinRule = { id: string; alternative: string };
type NetworkPaths = {
  KOTLIN_RULES: KotlinRule[];
  findSourceViolations(files: SourceFile[]): string[];
};

async function load(): Promise<NetworkPaths> {
  return (await import(pathToFileURL(SCRIPT).href)) as NetworkPaths;
}

// The alternatives the spec's "Kotlin and Java rules" table gives each rule, compared without backticks.
const ALTERNATIVE: Record<string, string> = {
  K1: "Build the data source over `OctaveHttp.callFactory(session)`, the one authenticated client.",
  K2: "Build the data source over `OctaveHttp.callFactory(session)`, the one authenticated client.",
  K3: "State the data source: call `setDataSourceFactory(...)` with a factory built over `OctaveHttp.callFactory(session)`.",
  K4: "Send through `OctaveHttp.callFactory(session)`. Octave has one `OkHttpClient`, built in `OctaveHttp.kt`.",
  K5: "Send through `OctaveHttp.callFactory(session)`. Octave has one `OkHttpClient`, built in `OctaveHttp.kt`.",
  K6: "State the media source factory: call `setMediaSourceFactory(...)` with one whose data source is built over `OctaveHttp.callFactory(session)`.",
  K7: "The one client is never registered with React Native or Expo, and Octave uses none of their clients (decision 0005). Send through `OctaveHttp.callFactory(session)`.",
  K8: "The one client carries one interceptor, `SessionInterceptor`, and no network interceptor.",
  K9: "A WebView cannot send the header (invariant I7). Draw with native views; fetch through `OctaveHttp.callFactory(session)`.",
  K10: "Do not reach another module's `internal` members. Ask the session module for `OctaveHttp.callFactory(session)`.",
};

const plain = (text: string) => text.replace(/`/g, "").replace(/\s+/g, " ").trim();

const OCTAVE_HTTP_PATH = "modules/session/android/src/main/java/dev/octave/session/http/OctaveHttp.kt";
const OCTAVE_HTTP = readFileSync(join(repo, OCTAVE_HTTP_PATH), "utf8");
const PROBE = "modules/session/android/src/main/java/dev/octave/session/Probe.kt";
const PROBE_JAVA = "modules/session/android/src/main/java/dev/octave/session/Probe.java";
const PLUGIN = "apps/tv/plugins/with-probe.js";

// A Kotlin file whose `body` starts on line 3, so a body's first line is reported as line 3.
const kotlin = (body: string, path = PROBE): SourceFile => ({ path, text: `package dev.octave.session\n\n${body}\n` });
const BODY_LINE = 3;

// OctaveHttp.kt with an import inserted after its package line (line 2), or a line appended at its end (END_LINE), so an
// appended builder is the file's second one.
const importIntoOctaveHttp = (line: string): SourceFile => {
  const [first, ...rest] = OCTAVE_HTTP.split("\n");
  return { path: OCTAVE_HTTP_PATH, text: [first, line, ...rest].join("\n") };
};
const appendToOctaveHttp = (line: string): SourceFile => ({ path: OCTAVE_HTTP_PATH, text: `${OCTAVE_HTTP.replace(/\n$/, "")}\n${line}\n` });
const END_LINE = OCTAVE_HTTP.replace(/\n$/, "").split("\n").length + 1;

type Sample = { fail: SourceFile; line: number; pass: SourceFile };

// One failing and one passing sample per rule id (item 4). Each passing sample passes every rule.
const SAMPLES: Record<string, Sample> = {
  K1: {
    fail: kotlin("val sources = DefaultHttpDataSource.Factory()"),
    line: BODY_LINE,
    pass: kotlin("val sources = OkHttpDataSource.Factory(OctaveHttp.callFactory(session))"),
  },
  K2: {
    fail: kotlin("val sources = DefaultDataSource.Factory(context)"),
    line: BODY_LINE,
    pass: kotlin("val sources = OkHttpDataSource.Factory(OctaveHttp.callFactory(session))"),
  },
  K3: {
    fail: kotlin("val media = DefaultMediaSourceFactory(context)"),
    line: BODY_LINE,
    pass: kotlin("val media = DefaultMediaSourceFactory(context).setDataSourceFactory(octaveDataSources)"),
  },
  K4: {
    fail: kotlin("val other = OkHttpClient()"),
    line: BODY_LINE,
    pass: kotlin("val call = OctaveHttp.callFactory(session).newCall(request)"),
  },
  K5: {
    fail: kotlin("val connection = URL(address).openConnection() as HttpURLConnection"),
    line: BODY_LINE,
    pass: kotlin('val query = java.net.URLEncoder.encode(value, "UTF-8")'),
  },
  K6: {
    fail: kotlin("val player = ExoPlayer.Builder(context).build()"),
    line: BODY_LINE,
    pass: kotlin("val player = ExoPlayer.Builder(context).setMediaSourceFactory(octaveMediaSources).build()"),
  },
  K7: {
    fail: kotlin("val client = OkHttpClientProvider.getOkHttpClient()"),
    line: BODY_LINE,
    pass: kotlin("import expo.modules.kotlin.modules.Module"),
  },
  K8: {
    fail: kotlin("val inspector = HttpLoggingInterceptor()"),
    line: BODY_LINE,
    pass: { path: OCTAVE_HTTP_PATH, text: OCTAVE_HTTP },
  },
  K9: {
    fail: kotlin("val view = WebView(context)"),
    line: BODY_LINE,
    pass: kotlin("val view = TextView(context)"),
  },
  K10: {
    fail: kotlin('@Suppress("INVISIBLE_MEMBER")\nval header = SessionRegistry.entry(session)'),
    line: BODY_LINE,
    pass: kotlin('@Suppress("unused")\nval call = OctaveHttp.callFactory(session)'),
  },
};

async function violations(...files: SourceFile[]): Promise<string[]> {
  return (await load()).findSourceViolations(files);
}

// The line for `file` at `line` that names `rule`'s alternative.
function expectNamed(found: string[], file: SourceFile, line: number, rule: string): void {
  const prefix = `ERROR network: ${file.path}:${line}: `;
  const hit = found.filter((entry) => entry.startsWith(prefix) && plain(entry).includes(plain(ALTERNATIVE[rule])));
  expect(hit, `${rule} at ${file.path}:${line} in:\n${found.join("\n")}`).not.toEqual([]);
}

async function expectFails(rule: string, file: SourceFile, line: number): Promise<void> {
  expectNamed(await violations(file), file, line, rule);
}

async function expectPasses(...files: SourceFile[]): Promise<void> {
  expect(await violations(...files)).toEqual([]);
}

// Octave's Kotlin and Java (outside tests and build output) and the config plugins, as the command reads them.
function octaveSource(): SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (dir: string, keep: (path: string) => boolean) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const path = relative(repo, full).split("\\").join("/");
      if (statSync(full).isDirectory()) {
        if (name === "build" || name === "node_modules" || path.endsWith("/src/test")) continue;
        walk(full, keep);
      } else if (keep(path)) {
        files.push({ path, text: readFileSync(full, "utf8") });
      }
    }
  };
  const kotlinOrJava = (path: string) => /\.(kt|java)$/.test(path);
  for (const module of readdirSync(join(repo, "modules"))) walk(join(repo, "modules", module, "android", "src"), kotlinOrJava);
  walk(join(repo, "apps", "tv", "native"), kotlinOrJava);
  walk(join(repo, "apps", "tv", "plugins"), (path) => path.endsWith(".js"));
  return files;
}

describe("T3-04 item 1: Media3's default data sources and media source factory", () => {
  it.each([
    ["DefaultHttpDataSource.Factory", "val sources = DefaultHttpDataSource.Factory()"],
    ["an import of DefaultHttpDataSource", "import androidx.media3.datasource.DefaultHttpDataSource"],
    ["HttpEngineDataSource", "val sources = HttpEngineDataSource.Factory(engine, executor)"],
  ])("T3-04 item 1: K1 fails %s", async (_name, body) => {
    await expectFails("K1", kotlin(body), BODY_LINE);
  });

  it.each([
    ["DefaultDataSource.Factory", "val sources = DefaultDataSource.Factory(context)"],
    ["DefaultDataSource", "val source = DefaultDataSource(context, true)"],
    ["the older DefaultDataSourceFactory", 'val sources = DefaultDataSourceFactory(context, "agent")'],
  ])("T3-04 item 1: K2 fails %s", async (_name, body) => {
    await expectFails("K2", kotlin(body), BODY_LINE);
  });

  it("T3-04 item 1: K2 fails DefaultDataSource in Java", async () => {
    const file = { path: PROBE_JAVA, text: "package dev.octave.session;\n\nclass Probe { Object f = new DefaultDataSource.Factory(context); }\n" };
    await expectFails("K2", file, 3);
  });

  it("T3-04 item 1: K3 fails a DefaultMediaSourceFactory with no stated data source", async () => {
    await expectFails("K3", kotlin("val media = DefaultMediaSourceFactory(context)"), BODY_LINE);
  });

  it("T3-04 item 1: K3 passes a DefaultMediaSourceFactory with setDataSourceFactory", async () => {
    await expectPasses(kotlin("val media = DefaultMediaSourceFactory(context)\n    .setDataSourceFactory(octaveDataSources)"));
  });

  it("T3-04 item 1: a data source built over the one client passes K1 and K2", async () => {
    await expectPasses(kotlin("val sources = OkHttpDataSource.Factory(OctaveHttp.callFactory(session))"));
  });

  it("T3-04 item 1: a default data source named only in a comment passes", async () => {
    await expectPasses(kotlin("// Never DefaultHttpDataSource or DefaultDataSource.Factory.\n/* DefaultMediaSourceFactory(context) */\nval x = 1"));
  });

  it("T3-04 item 1: a full name inside a string fails", async () => {
    await expectFails("K1", kotlin('val type = Class.forName("androidx.media3.datasource.DefaultHttpDataSource")'), BODY_LINE);
  });

  it("T3-04 item 1: Octave's real Kotlin, Java and plugin source passes", async () => {
    const files = octaveSource();
    expect(files.map((file) => file.path)).toContain(OCTAVE_HTTP_PATH);
    expect(await violations(...files)).toEqual([]);
  });
});

describe("T3-04 item 2: another client, HttpURLConnection, an ExoPlayer without a stated media source factory", () => {
  it.each([
    ["a second OkHttpClient", "val other = OkHttpClient()"],
    ["a second builder", "val other = OkHttpClient.Builder().build()"],
    ["a full name", "val other = okhttp3.OkHttpClient()"],
    ["a .client read in another file", "val call = OctaveHttp.client.newCall(request)"],
    ["a socket", "val socket = java.net.Socket(host, 443)"],
    ["a datagram socket", "val socket = DatagramSocket()"],
    ["java.net.http", "val http = java.net.http.HttpClient.newHttpClient()"],
    ["DownloadManager", "val downloads = context.getSystemService(DownloadManager::class.java)"],
    ["Cronet", "val engine = CronetEngine.Builder(context).build()"],
  ])("T3-04 item 2: K4 fails %s", async (_name, body) => {
    await expectFails("K4", kotlin(body), BODY_LINE);
  });

  it.each([
    ["a second builder", "val other = OkHttpClient.Builder().build()"],
    ["a spaced second builder", "val other = OkHttpClient.Builder ().build()"],
    ["a client derived with newBuilder()", "val other = client.newBuilder().build()"],
  ])("T3-04 item 2: K4 fails %s in OctaveHttp.kt", async (_name, line) => {
    await expectFails("K4", appendToOctaveHttp(line), END_LINE);
  });

  it.each([
    ["an alias import", "import okhttp3.OkHttpClient as Client"],
    ["a member import", "import okhttp3.OkHttpClient.Builder"],
  ])("T3-04 item 2: K4 fails %s in OctaveHttp.kt", async (_name, line) => {
    await expectFails("K4", importIntoOctaveHttp(line), 2);
  });

  it.each([
    ["callFactory", "val call = OctaveHttp.callFactory(session).newCall(request)"],
    ["request.newBuilder()", "val tagged = request.newBuilder().build()"],
    ["response.newBuilder()", "val copy = response.newBuilder().build()"],
    ["a message that says client", 'throw java.io.IOException("the client refused it")'],
  ])("T3-04 item 2: K4 passes %s", async (_name, body) => {
    await expectPasses(kotlin(body));
  });

  it.each([
    ["HttpURLConnection", "val connection = address.openConnection() as HttpURLConnection"],
    ["HttpsURLConnection", "val connection: javax.net.ssl.HttpsURLConnection? = null"],
    ["URLConnection", "val connection: java.net.URLConnection? = null"],
    ["URL(", 'val address = URL("http://192.0.2.1/")'],
    [".toURL(", "val address = uri.toURL()"],
    ["openConnection(", "val connection = address.openConnection()"],
    ["openStream(", "val body = address.openStream()"],
  ])("T3-04 item 2: K5 fails %s", async (_name, body) => {
    await expectFails("K5", kotlin(body), BODY_LINE);
  });

  it.each([
    ["URLEncoder", 'val query = java.net.URLEncoder.encode(value, "UTF-8")'],
    ["okhttp3.HttpUrl", 'val address: okhttp3.HttpUrl = "http://192.0.2.1/".toHttpUrl()'],
    ["an identifier that ends URL (HttpRefusal.CREDENTIAL_URL)", 'CREDENTIAL_URL("credential-url"),'],
  ])("T3-04 item 2: K5 passes %s", async (_name, body) => {
    await expectPasses(kotlin(body));
  });

  it("T3-04 item 2: K6 fails an ExoPlayer.Builder with no stated media source factory", async () => {
    await expectFails("K6", kotlin("val player = ExoPlayer.Builder(context).build()"), BODY_LINE);
  });

  it("T3-04 item 2: K6 fails an imported ExoPlayer.Builder with no stated media source factory", async () => {
    await expectFails("K6", kotlin("import androidx.media3.exoplayer.ExoPlayer.Builder\nval player = Builder(context).build()"), BODY_LINE);
  });

  it("T3-04 item 2: K6 passes an ExoPlayer.Builder with setMediaSourceFactory", async () => {
    await expectPasses(kotlin("val player = ExoPlayer.Builder(context)\n    .setMediaSourceFactory(octaveMediaSources)\n    .build()"));
  });

  it("T3-04 item 2: a config plugin that writes an OkHttpClient into the generated project fails", async () => {
    const file = { path: PLUGIN, text: "const KOTLIN = `\nval other = okhttp3.OkHttpClient()\n`;\nmodule.exports = KOTLIN;\n" };
    await expectFails("K4", file, 2);
  });

  it("T3-04 item 2: ordinary JavaScript in a config plugin passes", async () => {
    await expectPasses({ path: PLUGIN, text: "const base = new URL(config.url);\nconst client = config.client;\nmodule.exports = { base, client };\n" });
  });

  it("T3-04 item 2: Octave's real source passes, OctaveHttp.kt and DirectSocketFactory.kt included", async () => {
    const files = octaveSource();
    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining([OCTAVE_HTTP_PATH, "modules/session/android/src/main/java/dev/octave/session/http/DirectSocketFactory.kt"]),
    );
    expect(await violations(...files)).toEqual([]);
  });
});

describe("T3-04 item 4: every Kotlin rule has a failing and a passing sample, and names its alternative", () => {
  it("T3-04 item 4: KOTLIN_RULES holds exactly the rules this table has samples for", async () => {
    const ids = (await load()).KOTLIN_RULES.map((rule) => rule.id);
    expect([...ids].sort()).toEqual(Object.keys(SAMPLES).sort());
  });

  it("T3-04 item 4: each rule's alternative is the spec's", async () => {
    for (const rule of (await load()).KOTLIN_RULES) {
      expect(plain(rule.alternative), rule.id).toBe(plain(ALTERNATIVE[rule.id] ?? ""));
    }
  });

  it.each(Object.keys(SAMPLES))("T3-04 item 4: %s fails its failing sample with its alternative, on its line", async (id) => {
    const rule = (await load()).KOTLIN_RULES.find((entry) => entry.id === id);
    expect(rule, id).toBeDefined();
    const sample = SAMPLES[id];
    const found = await violations(sample.fail);
    const prefix = `ERROR network: ${sample.fail.path}:${sample.line}: `;
    expect(found.some((line) => line.startsWith(prefix) && line.includes(rule!.alternative)), found.join("\n")).toBe(true);
  });

  it.each(Object.keys(SAMPLES))("T3-04 item 4: %s passes its passing sample", async (id) => {
    await expectPasses(SAMPLES[id].pass);
  });
});

describe("T3-04 item 5: the check runs in pnpm check and in CI", () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  });

  function tree(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "octave-network-paths-"));
    roots.push(dir);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return dir;
  }

  function command(...args: string[]) {
    const child = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return { status: child.status, stdout: child.stdout ?? "", stderr: child.stderr ?? "" };
  }

  const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { scripts: Record<string, string> };

  it("T3-04 item 5: package.json has the lint:network script", () => {
    expect(pkg.scripts["lint:network"]).toBe("node scripts/check-network-paths.mjs");
  });

  it("T3-04 item 5: pnpm check runs pnpm lint:network right after pnpm lint", () => {
    const steps = pkg.scripts.check.split(" && ").map((step) => step.trim());
    expect(steps).toContain("pnpm lint:network");
    expect(steps.indexOf("pnpm lint:network")).toBe(steps.indexOf("pnpm lint") + 1);
  });

  it("T3-04 item 5: CI's checks job runs pnpm lint:network right after pnpm lint", () => {
    const lines = readFileSync(join(repo, ".github", "workflows", "ci.yml"), "utf8").split("\n");
    const start = lines.findIndex((line) => line === "  checks:");
    expect(start).toBeGreaterThan(-1);
    const end = lines.findIndex((line, i) => i > start && /^  \S/.test(line));
    const runs = lines
      .slice(start + 1, end === -1 ? undefined : end)
      .map((line) => /^\s+(?:- )?run:\s*(.+)$/.exec(line)?.[1].replace(/\s+#.*$/, "").trim())
      .filter((run): run is string => run !== undefined);
    expect(runs).toContain("pnpm lint:network");
    expect(runs.indexOf("pnpm lint:network")).toBe(runs.indexOf("pnpm lint") + 1);
  });

  it(
    "T3-04 item 5: the command exits 1 on a tree with a violating file and names it",
    () => {
      const path = "modules/probe/android/src/main/java/dev/octave/probe/Probe.kt";
      const root = tree({ [path]: "package dev.octave.probe\n\nval other = okhttp3.OkHttpClient()\n" });
      const { status, stderr } = command("--root", root);
      expect(status).toBe(1);
      const line = stderr.split("\n").find((entry) => entry.startsWith(`ERROR network: ${path}:3: `));
      expect(line, stderr).toBeDefined();
      expect(plain(line!)).toContain(plain(ALTERNATIVE.K4));
    },
    TIMEOUT,
  );

  it(
    "T3-04 item 5: the command exits 1 on a tree with no Kotlin file",
    () => {
      const root = tree({ "README.md": "nothing to read\n" });
      const { status, stdout, stderr } = command("--root", root);
      expect(status).toBe(1);
      expect(`${stdout}\n${stderr}`).toMatch(/network:/);
      expect(stdout).not.toMatch(/0 violations/);
    },
    TIMEOUT,
  );

  it(
    "T3-04 item 5: the command exits 0 on the repository and prints its counts",
    () => {
      const { status, stdout, stderr } = command();
      expect(stderr).not.toMatch(/ERROR network:/);
      expect(stdout).toMatch(/network: [1-9]\d* Octave files, [1-9]\d* linked files, 0 violations/);
      expect(status).toBe(0);
    },
    TIMEOUT,
  );
});
