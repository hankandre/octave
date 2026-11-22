// @vitest-environment node
// T3-04 items 6 and 7: how the check treats each HTTP path that Expo and React Native link into the APK. Each path is
// refused in Octave's code by a named rule (an ESLint rule or a Kotlin rule of `pnpm lint:network`), and each library
// file that can open a connection sits on the allowlist LINKED_NETWORK_PATHS with its reason. A source inventory of the
// installed libraries fails when a file opens an HTTP path and is not listed, or a listed file no longer does.
//
// The interface these frozen tests hold (spec, Approach "Shape" and "Linked paths"; spec check issue 5):
// - LINKED_NETWORK_PATHS: { id, package, file, what, verdict, reason, refusedBy }[]; `package` is the name the app
//   depends on (`react-native`, not the fork's name), `file` is relative to the package's folder with forward slashes.
//   A path with several library files has one entry per file, all with its id.
// - findLinkedClients(packages: { name, dir }[]): { package, file }[] lists each `.kt` and `.java` file under the
//   package's `android/src/main` or `ReactAndroid/src/main` (never `build/`) that can open a connection.
// - judgeLinkedClients(found, allowlist): string[] of `ERROR network:` lines (the spec's two messages).
// - findSourceViolations and KOTLIN_RULES as in scripts/check-network-paths.test.ts.
//
// Product Owner ruling of 2026-11-22 (T3-19 item 3; tasks/product-owner-log.md): expo-file-system, expo-asset,
// @expo/log-box and @expo/dom-webview may be excluded from autolinking. For each of the four, exactly one holds: it is
// linked, and its test is T3-04's as frozen; or apps/tv/package.json excludes it from Android autolinking, and
// LINKED_NETWORK_PATHS has no row for it. The rules that refuse it in Octave's code are tested either way. No other
// package can leave these tests through the exclusion list.
//
// Spec check issue 3: react-native-worklets (a direct dependency) links two such files; they are tested under item 7
// without pinning their entry id. Spec check issue 8: `hasWebView(` is not a WebView.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT = 60_000;
const ESLINT = ["--import", "./scripts/typescript-6-resolve.mjs", "node_modules/eslint/bin/eslint.js", "--max-warnings", "0"];

type SourceFile = { path: string; text: string };
type Found = { package: string; file: string };
type Entry = { id: string; package: string; file: string; what: string; verdict: string; reason: string; refusedBy: string | string[] };
type NetworkPaths = {
  KOTLIN_RULES: { id: string; alternative: string }[];
  findSourceViolations(files: SourceFile[]): string[];
  LINKED_NETWORK_PATHS: Entry[];
  findLinkedClients(packages: { name: string; dir: string }[]): Found[];
  judgeLinkedClients(found: Found[], allowlist: Entry[]): string[];
};

async function load(): Promise<NetworkPaths> {
  return (await import(pathToFileURL(join(repo, "scripts", "check-network-paths.mjs")).href)) as NetworkPaths;
}

const plain = (text: string) => text.replace(/`/g, "").replace(/\s+/g, " ").trim();

const KOTLIN_ALTERNATIVE: Record<string, string> = {
  K7: "The one client is never registered with React Native or Expo, and Octave uses none of their clients (decision 0005). Send through `OctaveHttp.callFactory(session)`.",
  K8: "The one client carries one interceptor, `SessionInterceptor`, and no network interceptor.",
  K9: "A WebView cannot send the header (invariant I7). Draw with native views; fetch through `OctaveHttp.callFactory(session)`.",
};
const TS_ALTERNATIVE: Record<string, string> = {
  T1: "The app sends nothing from JavaScript (decision 0005). Call the gateway in `@octave/core`; it sends through the Transport port and the native session module.",
  T3: 'React Native\'s `Image` shows bundled assets only: `source={require("./file.png")}`. Server artwork goes through the native image view (T3-11); video through the PlayerEngine launch request.',
  T4: "This package opens its own HTTP path, which cannot send the header. Use the gateway in `@octave/core` for data and the native image view (T3-11) for artwork.",
  T5: "A WebView cannot send the header (invariant I7). Build the screen from the shared native controls.",
};

// --- the installed packages -------------------------------------------------------------------------------------

// The app's own dependencies resolve from apps/tv; Expo's packages are not hoisted there, so they resolve from expo.
const fromApp = createRequire(join(repo, "apps", "tv", "package.json"));
const fromExpo = createRequire(fromApp.resolve("expo/package.json"));

function packageDir(name: string): string {
  for (const require of [fromApp, fromExpo]) {
    try {
      return dirname(require.resolve(`${name}/package.json`));
    } catch {
      // try the next
    }
  }
  throw new Error(`cannot resolve ${name} from apps/tv or expo`);
}

// T3-19 item 3 names these four and no other. Each maps to the id of its rows.
const MAY_BE_UNLINKED: Record<string, string> = {
  "expo-file-system": "E2",
  "expo-asset": "E3",
  "@expo/log-box": "E4",
  "@expo/dom-webview": "E5",
};

// What expo-modules-autolinking excludes on Android, read as it reads it (58.1.0, build/commands/autolinkingOptions.js,
// parsePackageJsonOptions): `expo.autolinking.android` is spread over `expo.autolinking`, so an `exclude` under
// `android` replaces the top-level one, it is never merged with it; a value that is not a list excludes nothing.
function excludedOnAndroid(): Set<string> {
  const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
  const manifest: unknown = JSON.parse(readFileSync(join(repo, "apps", "tv", "package.json"), "utf8"));
  const expo = isObject(manifest) && isObject(manifest.expo) ? manifest.expo : {};
  const autolinking = isObject(expo.autolinking) ? expo.autolinking : {};
  const merged = { ...autolinking, ...(isObject(autolinking.android) ? autolinking.android : {}) };
  const exclude: unknown[] = Array.isArray(merged.exclude) ? merged.exclude : [];
  return new Set(exclude.filter((name): name is string => typeof name === "string"));
}

const EXCLUDED = excludedOnAndroid();
const UNLINKED = new Set(Object.keys(MAY_BE_UNLINKED).filter((name) => EXCLUDED.has(name)));

const REAL_PACKAGES = [
  "expo",
  "expo-modules-core",
  "expo-file-system",
  "expo-asset",
  "@expo/log-box",
  "@expo/dom-webview",
  "react-native",
  "react-native-worklets",
  "react-native-reanimated",
  "react-native-screens",
  "react-native-safe-area-context",
  "@shopify/flash-list",
]
  .filter((name) => !UNLINKED.has(name))
  .map((name) => ({ name, dir: packageDir(name) }));

// --- helpers --------------------------------------------------------------------------------------------------

const PROBE = "modules/session/android/src/main/java/dev/octave/session/Probe.kt";
const kotlin = (body: string): SourceFile => ({ path: PROBE, text: `package dev.octave.session\n\n${body}\n` });

async function expectKotlinRefused(rule: string, body: string): Promise<void> {
  const found = (await load()).findSourceViolations([kotlin(body)]);
  const hit = found.filter((line) => line.startsWith(`ERROR network: ${PROBE}:3: `) && plain(line).includes(plain(KOTLIN_ALTERNATIVE[rule])));
  expect(hit, `${rule} on ${body}:\n${found.join("\n")}`).not.toEqual([]);
}

function expectLintRefused(rule: string, path: string, code: string): void {
  const child = spawnSync(process.execPath, [...ESLINT, "--stdin", "--stdin-filename", path], { cwd: repo, input: code, encoding: "utf8" });
  const output = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
  expect(child.status, output).not.toBe(0);
  expect(output).toMatch(/no-restricted-(globals|properties|imports|syntax)/);
  expect(plain(output), output).toContain(plain(TS_ALTERNATIVE[rule]));
}

const nonEmpty = (value: unknown) => (Array.isArray(value) ? value.length > 0 && value.every((part) => String(part).trim() !== "") : typeof value === "string" && value.trim() !== "");

// The path's entries are on the allowlist with a reason and a refusing rule, name each expected file, and each named
// file exists in the installed package and is still listed by the inventory.
async function expectAllowlisted(entries: Entry[], packageName: string, fileSuffixes: string[]): Promise<void> {
  const { findLinkedClients } = await load();
  expect(entries.length, `entries for ${packageName}`).toBeGreaterThan(0);
  for (const entry of entries) {
    expect(entry.package).toBe(packageName);
    expect(nonEmpty(entry.reason), `${entry.id} reason`).toBe(true);
    expect(nonEmpty(entry.refusedBy), `${entry.id} refusedBy`).toBe(true);
  }
  for (const suffix of fileSuffixes) {
    expect(entries.map((entry) => entry.file).some((file) => file.endsWith(suffix)), `${packageName} ${suffix}`).toBe(true);
  }
  const pkg = REAL_PACKAGES.find((candidate) => candidate.name === packageName)!;
  const listed = findLinkedClients([pkg]);
  for (const entry of entries) {
    expect(existsSync(join(pkg.dir, entry.file)), `${packageName}/${entry.file} exists`).toBe(true);
    expect(listed, `${packageName}/${entry.file} still opens an HTTP path`).toContainEqual({ package: packageName, file: entry.file });
  }
}

async function entriesFor(id: string): Promise<Entry[]> {
  return (await load()).LINKED_NETWORK_PATHS.filter((entry) => entry.id === id);
}

// One of the four packages of MAY_BE_UNLINKED: allowlisted as frozen while it is linked; with no row at all, by id or
// by package name, once it is excluded from autolinking.
async function expectAllowlistedOrUnlinked(packageName: string, fileSuffixes: string[]): Promise<void> {
  const id = MAY_BE_UNLINKED[packageName];
  expect(id, `${packageName} is not one of the four packages T3-19 may unlink`).toBeDefined();
  if (!UNLINKED.has(packageName)) {
    await expectAllowlisted(await entriesFor(id), packageName, fileSuffixes);
    return;
  }
  const rows = (await load()).LINKED_NETWORK_PATHS.filter((entry) => entry.id === id || entry.package === packageName);
  expect(rows, `${packageName} is excluded from autolinking in apps/tv/package.json, so LINKED_NETWORK_PATHS may hold no row for it`).toEqual([]);
}

// --- item 6: what Expo links ----------------------------------------------------------------------------------

describe("T3-04 item 6: the HTTP paths Expo links into the APK", () => {
  it(
    "T3-04 item 6: E1 expo/fetch is allowlisted and refused in Octave's code (T1, T4, K7)",
    async () => {
      await expectAllowlisted(await entriesFor("E1"), "expo", ["expo/modules/fetch/ExpoFetchModule.kt"]);
      expectLintRefused("T1", "apps/tv/src/probe.tsx", 'export const load = fetch("/x");\n');
      expectLintRefused("T4", "apps/tv/src/probe.tsx", 'import { fetch as expoFetch } from "expo/fetch";\nexport const load = expoFetch;\n');
      await expectKotlinRefused("K7", "import expo.modules.fetch.ExpoFetchModule");
    },
    TIMEOUT,
  );

  it(
    "T3-04 item 6: E2 expo-file-system's own OkHttpClient is allowlisted and refused in Octave's code (T4, K7)",
    async () => {
      await expectAllowlistedOrUnlinked("expo-file-system", [
        "FileSystemDownload.kt",
        "legacy/FileSystemLegacyModule.kt",
        "FileSystemDownloadTask.kt",
        "FileSystemUploadTask.kt",
      ]);
      expectLintRefused("T4", "apps/tv/src/probe.tsx", 'import * as FileSystem from "expo-file-system";\nexport const fs = FileSystem;\n');
      expectLintRefused("T4", "apps/tv/src/probe.tsx", 'export const legacy = require("expo-file-system/legacy");\n');
      await expectKotlinRefused("K7", "import expo.modules.filesystem.FileSystemDownload");
    },
    TIMEOUT,
  );

  it(
    "T3-04 item 6: E3 expo-asset is allowlisted and refused in Octave's code (T4, K7)",
    async () => {
      await expectAllowlistedOrUnlinked("expo-asset", ["ResourceAsset.kt"]);
      expectLintRefused("T4", "apps/tv/src/probe.tsx", 'import { Asset } from "expo-asset";\nexport const asset = Asset;\n');
      await expectKotlinRefused("K7", "import expo.modules.asset.ResourceAsset");
    },
    TIMEOUT,
  );

  it(
    "T3-04 item 6: E4 @expo/log-box is allowlisted and refused in Octave's code (T4, K7)",
    async () => {
      await expectAllowlistedOrUnlinked("@expo/log-box", ["ExpoLogBoxSurfaceDelegate.kt", "ExpoLogBoxWebViewWrapper.kt"]);
      expectLintRefused("T4", "apps/tv/src/probe.tsx", 'export const logBox = import("@expo/log-box");\n');
      await expectKotlinRefused("K7", "import expo.modules.logbox.ExpoLogBoxSurfaceDelegate");
    },
    TIMEOUT,
  );

  it(
    'T3-04 item 6: E5 @expo/dom-webview and "use dom" are allowlisted and refused in Octave\'s code (T4, T5, K7, K9)',
    async () => {
      await expectAllowlistedOrUnlinked("@expo/dom-webview", ["DomWebView.kt"]);
      expectLintRefused("T4", "apps/tv/src/probe.tsx", 'import { DomWebView } from "@expo/dom-webview";\nexport const view = DomWebView;\n');
      expectLintRefused("T5", "apps/tv/src/probe.tsx", '"use dom";\nexport default function Page() {\n  return null;\n}\n');
      await expectKotlinRefused("K7", "import expo.modules.webview.DomWebView");
      await expectKotlinRefused("K9", "val view = android.webkit.WebView(context)");
    },
    TIMEOUT,
  );

  it("T3-04 item 6: E6 expo-modules-core's network-inspector interceptors are not allowlisted and are refused on the one client (K8)", async () => {
    const { LINKED_NETWORK_PATHS } = await load();
    expect(LINKED_NETWORK_PATHS.filter((entry) => entry.file.endsWith("ExpoNetworkInspectOkHttpInterceptors.kt"))).toEqual([]);
    await expectKotlinRefused("K8", "val built = builder.addNetworkInterceptor(ExpoNetworkInspectOkHttpNetworkInterceptor())");
    await expectKotlinRefused("K8", "import expo.modules.kotlin.devtools.ExpoNetworkInspectOkHttpAppInterceptor");
  });

  it("T3-04 item 6: E7 expo-modules-core's own use of React Native's provider is allowlisted and refused in Octave's code (K7)", async () => {
    await expectAllowlisted(await entriesFor("E7"), "expo-modules-core", ["expo/modules/kotlin/AppContext.kt"]);
    await expectKotlinRefused("K7", "val builder = OkHttpClientProvider.createClientBuilder()");
  });

  // The inventory itself, on made-up package trees.
  const roots: string[] = [];
  afterAll(() => {
    for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  });

  function fakePackage(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "octave-linked-"));
    roots.push(dir);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return dir;
  }

  const entry = (id: string, pkg: string, file: string): Entry => ({ id, package: pkg, file, what: "probe", verdict: "allowlisted", reason: "probe", refusedBy: ["K7"] });

  it("T3-04 item 6: the inventory fails a linked file that opens its own HTTP path and is not on the allowlist", async () => {
    const { findLinkedClients, judgeLinkedClients } = await load();
    const file = "android/src/main/java/probe/Client.kt";
    const dir = fakePackage({ [file]: "package probe\n\nval client = okhttp3.OkHttpClient()\n" });
    const found = findLinkedClients([{ name: "probe-lib", dir }]);
    expect(found).toEqual([{ package: "probe-lib", file }]);
    const errors = judgeLinkedClients(found, []);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`ERROR network: probe-lib/${file} opens its own HTTP path and is not on LINKED_NETWORK_PATHS.`);
    expect(judgeLinkedClients(found, [entry("X1", "probe-lib", file)])).toEqual([]);
  });

  it("T3-04 item 6: the inventory fails an allowlist entry whose file no longer opens an HTTP path", async () => {
    const { findLinkedClients, judgeLinkedClients } = await load();
    const file = "android/src/main/java/probe/Client.kt";
    const dir = fakePackage({ [file]: "package probe\n\nval answer = 42\n" });
    const found = findLinkedClients([{ name: "probe-lib", dir }]);
    expect(found).toEqual([]);
    const errors = judgeLinkedClients(found, [entry("X1", "probe-lib", file)]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`ERROR network: LINKED_NETWORK_PATHS entry X1 names ${file}, which no longer opens an HTTP path.`);
  });

  it("T3-04 item 6: the inventory lists each kind of client, in android/ and ReactAndroid/, and skips build output and tests", async () => {
    const { findLinkedClients } = await load();
    const dir = fakePackage({
      "android/src/main/java/probe/A.kt": "val a = OkHttpClient.Builder().build()\n",
      "android/src/main/java/probe/B.java": "class B { Object c = OkHttpClientProvider.getOkHttpClient(); }\n",
      "android/src/main/java/probe/C.kt": "val c = url.openConnection() as HttpURLConnection\n",
      "android/src/main/java/probe/D.kt": "val d = WebView(context)\n",
      "ReactAndroid/src/main/java/probe/F.kt": "val f = OkHttpClient()\n",
      "android/src/main/java/probe/Quiet.kt": "fun hasWebView(): Boolean = false\nval g = hasWebView()\n",
      "android/build/generated/probe/G.kt": "val g = OkHttpClient()\n",
      "android/src/test/java/probe/H.kt": "val h = OkHttpClient()\n",
    });
    const files = findLinkedClients([{ name: "probe-lib", dir }]).map((found) => found.file).sort();
    expect(files).toEqual([
      "ReactAndroid/src/main/java/probe/F.kt",
      "android/src/main/java/probe/A.kt",
      "android/src/main/java/probe/B.java",
      "android/src/main/java/probe/C.kt",
      "android/src/main/java/probe/D.kt",
    ]);
  });

  it("T3-04 item 6: the installed libraries pass the inventory against the allowlist", async () => {
    const { LINKED_NETWORK_PATHS, findLinkedClients, judgeLinkedClients } = await load();
    const found = findLinkedClients(REAL_PACKAGES);
    expect(found).toContainEqual({ package: "react-native", file: "ReactAndroid/src/main/java/com/facebook/react/modules/network/OkHttpClientProvider.kt" });
    const names = new Set(REAL_PACKAGES.map((pkg) => pkg.name));
    expect(judgeLinkedClients(found, LINKED_NETWORK_PATHS.filter((entry) => names.has(entry.package)))).toEqual([]);
  });
});

// --- item 7: React Native's own networking --------------------------------------------------------------------

describe("T3-04 item 7: React Native's own networking", () => {
  const NETWORK = "ReactAndroid/src/main/java/com/facebook/react/modules/network";

  it(
    "T3-04 item 7: R1 JavaScript fetch and XMLHttpRequest (NetworkingModule) are allowlisted and refused in Octave's code (T1, K7)",
    async () => {
      await expectAllowlisted(await entriesFor("R1"), "react-native", [`${NETWORK}/NetworkingModule.kt`, `${NETWORK}/OkHttpClientProvider.kt`]);
      expectLintRefused("T1", "apps/tv/src/probe.tsx", 'export const load = fetch("/x");\n');
      expectLintRefused("T1", "apps/tv/src/probe.tsx", "export const request = new XMLHttpRequest();\n");
      await expectKotlinRefused("K7", "import com.facebook.react.modules.network.NetworkingModule");
    },
    TIMEOUT,
  );

  it(
    "T3-04 item 7: R2 WebSocket (WebSocketModule) is allowlisted and refused in Octave's code (T1, K7)",
    async () => {
      await expectAllowlisted(await entriesFor("R2"), "react-native", ["ReactAndroid/src/main/java/com/facebook/react/modules/websocket/WebSocketModule.kt"]);
      expectLintRefused("T1", "apps/tv/src/probe.tsx", 'export const socket = new WebSocket("ws://192.0.2.1/socket");\n');
      await expectKotlinRefused("K7", "import com.facebook.react.modules.websocket.WebSocketModule");
    },
    TIMEOUT,
  );

  it(
    "T3-04 item 7: R3 a network source on React Native's Image (FrescoModule) is allowlisted and refused in Octave's code (T3, K7)",
    async () => {
      await expectAllowlisted(await entriesFor("R3"), "react-native", ["ReactAndroid/src/main/java/com/facebook/react/modules/fresco/FrescoModule.kt"]);
      expectLintRefused("T3", "apps/tv/src/probe.tsx", 'import { Image } from "react-native";\nexport const art = <Image source={{ uri: "http://192.0.2.1/a.jpg" }} />;\n');
      await expectKotlinRefused("K7", "import com.facebook.react.modules.fresco.FrescoModule");
    },
    TIMEOUT,
  );

  it("T3-04 item 7: R4 any call to OkHttpClientProvider is refused in Octave's code, and every linked caller is allowlisted", async () => {
    await expectKotlinRefused("K7", "OkHttpClientProvider.setOkHttpClientFactory { OctaveHttp.callFactory(session) }");
    await expectKotlinRefused("K7", "val client = OkHttpClientProvider.createClient(context)");
    await expectKotlinRefused("K7", "val client = com.facebook.react.modules.network.OkHttpClientProvider.getOkHttpClient()");
    const { LINKED_NETWORK_PATHS, findLinkedClients } = await load();
    const callers = findLinkedClients(REAL_PACKAGES).filter((found) => {
      const dir = REAL_PACKAGES.find((pkg) => pkg.name === found.package)!.dir;
      return readFileSync(join(dir, found.file), "utf8").includes("OkHttpClientProvider.");
    });
    expect(callers.length).toBeGreaterThan(0);
    for (const caller of callers) {
      expect(LINKED_NETWORK_PATHS.some((entry) => entry.package === caller.package && entry.file === caller.file), `${caller.package}/${caller.file}`).toBe(true);
    }
  });

  it("T3-04 item 7: R5 DevSupportHttpClient is allowlisted and refused in Octave's code (K7)", async () => {
    await expectAllowlisted(await entriesFor("R5"), "react-native", ["ReactAndroid/src/main/java/com/facebook/react/devsupport/inspector/DevSupportHttpClient.kt"]);
    await expectKotlinRefused("K7", "import com.facebook.react.devsupport.inspector.DevSupportHttpClient");
  });

  it("T3-04 item 7: react-native-worklets' fetch and script download are allowlisted, and its networking is refused in Octave's code (K7)", async () => {
    const { LINKED_NETWORK_PATHS } = await load();
    const entries = LINKED_NETWORK_PATHS.filter((entry) => entry.package === "react-native-worklets");
    await expectAllowlisted(entries, "react-native-worklets", ["com/swmansion/worklets/networking/Networking.kt", "com/swmansion/worklets/ScriptBufferWrapper.kt"]);
    await expectKotlinRefused("K7", "import com.swmansion.worklets.networking.Networking");
  });
});
