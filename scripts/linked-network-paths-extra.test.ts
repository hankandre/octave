// @vitest-environment node
// T3-04, beyond the frozen tests in scripts/linked-network-paths.test.ts: the inventory matches the same name list as
// the K rules (spec check issue 4), reads every shipping source set, walks the installed closure from apps/tv, and the
// allowlist entries the spec's table adds (E8, R1's RequestBodyUtil, R6, W1, W2) hold. Not frozen.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { findLinkedClients, judgeLinkedClients, KOTLIN_RULES, LINKED_NETWORK_PATHS, linkedPackages, NETWORK_OPENERS } from "./check-network-paths.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const roots: string[] = [];
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "octave-linked-extra-"));
  roots.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const listed = (files: Record<string, string>) =>
  findLinkedClients([{ name: "probe-lib", dir: tree(files) }])
    .map((found) => found.file)
    .sort();

describe("T3-04 inventory: one name list with the K rules", () => {
  it.each([
    ["openStream(", "val body = url.openStream()"],
    ["URL(", 'val address = URL("http://192.0.2.1/")'],
    ["a socket", "val socket = java.net.Socket(host, 443)"],
    ["DownloadManager", "val d = context.getSystemService(DownloadManager::class.java)"],
    ["Cronet", "val engine = CronetEngine.Builder(context).build()"],
    ["java.net.http", "val c = java.net.http.HttpClient.newHttpClient()"],
    ["URLConnection", "val c: java.net.URLConnection? = null"],
    ["Media3's default HTTP data source", "val s = DefaultHttpDataSource.Factory()"],
    ["a full name in a string", 'val t = Class.forName("java.net.HttpURLConnection")'],
  ])("lists a file with %s", (_name, body) => {
    expect(listed({ "android/src/main/java/probe/A.kt": `package probe\n\n${body}\n` })).toEqual(["android/src/main/java/probe/A.kt"]);
  });

  it.each([
    ["an identifier that ends URL", 'val r = CREDENTIAL_URL("credential-url")'],
    ["an identifier that ends WebView", "val shown = hasWebView()"],
    ["a name in a comment", "// URL(x).openConnection() as HttpURLConnection\nval a = 1"],
    ["a word in a string", 'val m = "open a URL connection"'],
    ["a type mention only", "fun apply(builder: OkHttpClient.Builder) {}"],
  ])("does not list a file with %s", (_name, body) => {
    expect(listed({ "android/src/main/java/probe/A.kt": `package probe\n\n${body}\n` })).toEqual([]);
  });

  it("every rule the shared list names is a K rule", () => {
    const ids = new Set(KOTLIN_RULES.map((rule) => rule.id));
    for (const name of NETWORK_OPENERS) expect(ids.has(name.rule), name.rule).toBe(true);
  });

  it("reads every shipping source set, and skips the test ones", () => {
    const client = "val c = OkHttpClient()\n";
    expect(
      listed({
        "android/src/fabric/java/probe/A.kt": client,
        "android/src/debug/java/probe/B.kt": client,
        "android/src/test/java/probe/C.kt": client,
        "android/src/androidTest/java/probe/D.kt": client,
        "android/src/testDebug/java/probe/E.kt": client,
      }),
    ).toEqual(["android/src/debug/java/probe/B.kt", "android/src/fabric/java/probe/A.kt"]);
  });
});

describe("T3-04 inventory: the installed closure", () => {
  it("walks dependencies and installed peers from apps/tv, skips workspace packages, and keeps the app's name for an alias", () => {
    const pkg = (name: string, extra: Record<string, unknown> = {}) => JSON.stringify({ name, version: "1.0.0", ...extra });
    const root = tree({
      "apps/tv/package.json": pkg("@octave/tv", { dependencies: { native: "1", alias: "npm:forked@1", "@octave/session": "workspace:*" } }),
      "node_modules/native/package.json": pkg("native", { dependencies: { deep: "1" }, peerDependencies: { peer: "*", absent: "*" } }),
      "node_modules/native/android/src/main/java/N.kt": "val n = 1\n",
      "node_modules/deep/package.json": pkg("deep"),
      "node_modules/deep/android/src/main/java/D.kt": "val d = 1\n",
      "node_modules/peer/package.json": pkg("peer"),
      "node_modules/peer/android/src/main/java/P.kt": "val p = 1\n",
      "node_modules/alias/package.json": pkg("forked"),
      "node_modules/alias/ReactAndroid/src/main/java/F.kt": "val f = 1\n",
      "node_modules/js-only/package.json": pkg("js-only"),
    });
    // A workspace package is a link from the app's node_modules out to modules/, as pnpm installs it.
    mkdirSync(join(root, "modules", "session", "android", "src", "main"), { recursive: true });
    writeFileSync(join(root, "modules", "session", "package.json"), pkg("@octave/session"));
    mkdirSync(join(root, "apps", "tv", "node_modules", "@octave"), { recursive: true });
    symlinkSync(join(root, "modules", "session"), join(root, "apps", "tv", "node_modules", "@octave", "session"), "dir");
    const { packages, errors } = linkedPackages(root);
    expect(errors).toEqual([]);
    expect(packages.map((found) => found.name).sort()).toEqual(["alias", "deep", "native", "peer"]);
  });

  it("fails a regular dependency that is not installed", () => {
    const root = tree({ "apps/tv/package.json": JSON.stringify({ name: "@octave/tv", dependencies: { missing: "1" } }) });
    expect(linkedPackages(root).errors).toEqual(["ERROR network: apps/tv depends on missing, which is not installed"]);
  });

  it("on the repository: finds react-native under the app's name, not @octave/session, and passes the allowlist", () => {
    const { packages, errors } = linkedPackages(repo);
    expect(errors).toEqual([]);
    const names = packages.map((found) => found.name);
    expect(names).toEqual(expect.arrayContaining(["react-native", "expo", "expo-modules-core", "react-native-worklets"]));
    expect(names).not.toContain("react-native-tvos");
    expect(names).not.toContain("@octave/session");
    expect(judgeLinkedClients(findLinkedClients(packages), LINKED_NETWORK_PATHS)).toEqual([]);
  });
});

describe("T3-04 allowlist: the entries beyond the spec's first table", () => {
  const ids = new Set([...KOTLIN_RULES.map((rule) => rule.id), "T1", "T2", "T3", "T4", "T5", "T6", "T7"]);

  it("every entry has a what, a verdict, a reason and refusing rules that exist", () => {
    for (const entry of LINKED_NETWORK_PATHS) {
      expect(entry.what.trim(), entry.id).not.toBe("");
      expect(entry.verdict, entry.id).toBe("allowlisted");
      expect(entry.reason.trim(), entry.id).not.toBe("");
      expect(entry.refusedBy.length, entry.id).toBeGreaterThan(0);
      for (const rule of entry.refusedBy) expect(ids.has(rule), `${entry.id} ${rule}`).toBe(true);
    }
  });

  it.each([
    ["R1", "react-native", "ReactAndroid/src/main/java/com/facebook/react/modules/network/RequestBodyUtil.kt"],
    ["R6", "react-native", "ReactAndroid/src/main/java/com/facebook/react/devsupport/DevSupportManagerBase.kt"],
    ["E1", "expo", "android/src/main/java/expo/modules/fetch/OkHttpFileUrlInterceptor.kt"],
    ["E8", "expo-modules-core", "android/src/main/java/expo/modules/kotlin/types/net/URLTypConverter.kt"],
    ["W1", "react-native-worklets", "android/src/main/java/com/swmansion/worklets/networking/Networking.kt"],
    ["W2", "react-native-worklets", "android/src/main/java/com/swmansion/worklets/ScriptBufferWrapper.kt"],
  ])("%s lists %s's %s", (id, pkgName, file) => {
    expect(LINKED_NETWORK_PATHS).toContainEqual(expect.objectContaining({ id, package: pkgName, file }));
  });

  it("no entry names the network-inspector interceptors (E6)", () => {
    expect(LINKED_NETWORK_PATHS.filter((entry) => entry.file.includes("ExpoNetworkInspect"))).toEqual([]);
  });
});
