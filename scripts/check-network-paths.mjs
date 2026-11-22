// Fails when Octave's Kotlin or Java opens a network path around the one authenticated client (T3-04). The rules
// K1 to K10 read Octave's source; every message names the allowed alternative. A JVM test in pnpm tv:native:test
// applies the same rules to Octave's compiled classes by type (apps/tv/native/.../NetworkPathsBytecodeTest.kt).
// Run: node scripts/check-network-paths.mjs [--root <dir>]   (pnpm lint:network)
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { LINKED_NETWORK_PATHS } from "./linked-network-paths.mjs";

export { LINKED_NETWORK_PATHS };
import { fileURLToPath } from "node:url";

const SEND_THROUGH = "Send through `OctaveHttp.callFactory(session)`. Octave has one `OkHttpClient`, built in `OctaveHttp.kt`.";
const BUILD_OVER = "Build the data source over `OctaveHttp.callFactory(session)`, the one authenticated client.";

export const OCTAVE_HTTP = "modules/session/android/src/main/java/dev/octave/session/http/OctaveHttp.kt";
export const DIRECT_SOCKETS = "modules/session/android/src/main/java/dev/octave/session/http/DirectSocketFactory.kt";

// --- names --------------------------------------------------------------------------------------------------------
// A name is matched as a whole identifier (or, with `prefix`, an identifier that starts with it). `$` counts as part of
// an identifier, so `CREDENTIAL_URL(` is not `URL(` and `hasWebView` is not `WebView`.
const ID = "A-Za-z0-9_$";
const word = (name) => new RegExp(`(?<![${ID}])${name}(?![${ID}])`);
const prefix = (name) => new RegExp(`(?<![${ID}])${name}[${ID}]*`);
const call = (name) => new RegExp(`(?<![${ID}])${name}\\s*\\(`);
const member = (name) => new RegExp(`\\.\\s*${name}\\s*\\(`);
const pkg = (name) => new RegExp(`(?<![${ID}.])${name.replace(/\./g, "\\.")}(?![${ID}])`);

// The forms that open a connection or name a network stack. One list serves the K rules and the inventory of linked
// libraries (spec, "The inventory"), so a dependency that adds any stack the K rules ban turns the check red. The K
// rules add, on top, the type names and hooks that open nothing by themselves (a parameter of type OkHttpClient).
export const NETWORK_OPENERS = [
  { rule: "K1", re: prefix("DefaultHttpDataSource"), what: "Media3's default HTTP data source" },
  { rule: "K1", re: prefix("HttpEngineDataSource"), what: "Media3's HttpEngine data source" },
  { rule: "K1", re: prefix("UdpDataSource"), what: "Media3's UDP data source" },
  { rule: "K1", re: prefix("RtspMediaSource"), what: "Media3's RTSP media source, which opens its own sockets" },
  { rule: "K1", re: prefix("RtmpDataSource"), what: "Media3's RTMP data source" },
  { rule: "K2", re: prefix("DefaultDataSource"), what: "Media3's default data source" },
  { rule: "K4", re: /(?<![A-Za-z0-9_$])OkHttpClient\s*(?:\.\s*Builder\s*)?\(/, what: "another OkHttpClient", oneClient: true },
  { rule: "K4", re: pkg("java.net.http"), what: "the JDK's HTTP client" },
  { rule: "K4", re: word("HttpClient"), what: "another HTTP client" },
  { rule: "K4", re: prefix("Cronet"), what: "Cronet, another HTTP stack" },
  { rule: "K4", re: prefix("Volley"), what: "Volley, another HTTP stack" },
  { rule: "K4", re: word("DownloadManager"), what: "DownloadManager, which fetches without the header" },
  // Players and image loaders that fetch a URL themselves, without the header (invariant I7).
  { rule: "K4", re: word("MediaPlayer"), what: "android.media.MediaPlayer, which fetches without the header" },
  { rule: "K4", re: word("VideoView"), what: "VideoView, which fetches without the header" },
  { rule: "K4", re: /(?<![A-Za-z0-9_$.])(?:coil3?|com\.bumptech\.glide|com\.squareup\.picasso)\./, what: "an image loader with its own HTTP path (Coil, Glide or Picasso)" },
  { rule: "K4", re: word("Glide"), what: "Glide, an image loader with its own HTTP path" },
  { rule: "K4", re: word("Picasso"), what: "Picasso, an image loader with its own HTTP path" },
  { rule: "K4", re: call("Socket"), what: "a raw socket", socket: true },
  { rule: "K4", re: call("SSLSocket"), what: "a raw socket", socket: true },
  { rule: "K4", re: prefix("SocketChannel"), what: "a raw socket channel", socket: true },
  { rule: "K4", re: prefix("DatagramSocket"), what: "a datagram socket", socket: true },
  { rule: "K4", re: prefix("AsynchronousSocketChannel"), what: "a raw socket channel", socket: true },
  { rule: "K5", re: word("HttpURLConnection"), what: "HttpURLConnection" },
  { rule: "K5", re: word("HttpsURLConnection"), what: "HttpsURLConnection" },
  { rule: "K5", re: word("URLConnection"), what: "URLConnection" },
  { rule: "K5", re: call("URL"), what: "java.net.URL, which opens its own connection" },
  { rule: "K5", re: member("toURL"), what: "java.net.URL, which opens its own connection" },
  { rule: "K5", re: call("openConnection"), what: "a URL connection" },
  { rule: "K5", re: call("openStream"), what: "a URL stream" },
  { rule: "K7", re: word("OkHttpClientProvider"), what: "React Native's OkHttpClientProvider" },
  { rule: "K9", re: call("WebView"), what: "a WebView" },
];

// Names a config plugin may not write into the generated project. Ordinary JavaScript (`new URL(`, `config.client`,
// a socket) is not matched there.
const PLUGIN_RULES = new Set(["K1", "K2", "K3", "K6", "K7", "K8", "K10"]);
const PLUGIN_NAMES = [
  { rule: "K4", re: word("OkHttpClient"), what: "an OkHttpClient" },
  { rule: "K5", re: word("HttpURLConnection"), what: "HttpURLConnection" },
  { rule: "K5", re: word("HttpsURLConnection"), what: "HttpsURLConnection" },
  { rule: "K5", re: word("URLConnection"), what: "URLConnection" },
];

const K7_HOOKS = [
  "OkHttpClientProvider",
  "OkHttpClientFactory",
  "CustomClientBuilder",
  "NetworkingModule",
  "WebSocketModule",
  "FrescoModule",
  "ReactOkHttpNetworkFetcher",
  "DevSupportHttpClient",
  "ScriptBufferWrapper",
];
const K7_PACKAGES = [
  "expo.modules.fetch",
  "expo.modules.filesystem",
  "expo.modules.asset",
  "expo.modules.logbox",
  "expo.modules.webview",
  "com.swmansion.worklets.networking",
];

// Each rule: its id, the alternative its message names, and `names`: the patterns that fail it wherever they stand
// (in code, and as a dotted full name inside a string). K3, K4 (in OctaveHttp.kt) and K6 add checks by file below.
export const KOTLIN_RULES = [
  { id: "K1", alternative: BUILD_OVER, names: NETWORK_OPENERS.filter((name) => name.rule === "K1") },
  { id: "K2", alternative: BUILD_OVER, names: NETWORK_OPENERS.filter((name) => name.rule === "K2") },
  {
    id: "K3",
    alternative: "State the data source: call `setDataSourceFactory(...)` with a factory built over `OctaveHttp.callFactory(session)`.",
    names: [],
  },
  { id: "K4", alternative: SEND_THROUGH, names: NETWORK_OPENERS.filter((name) => name.rule === "K4") },
  {
    id: "K5",
    alternative: SEND_THROUGH,
    // `URL` as a name, not only as a call: `import java.net.URL as Net` then `Net(address).readText()` opens a stream in
    // the Kotlin standard library, where no call of Octave's names `URL(` or `openStream(`.
    names: [...NETWORK_OPENERS.filter((name) => name.rule === "K5"), { re: word("URL"), what: "java.net.URL, which opens its own connection" }],
  },
  {
    id: "K6",
    alternative:
      "State the media source factory: call `setMediaSourceFactory(...)` with one whose data source is built over `OctaveHttp.callFactory(session)`.",
    names: [],
  },
  {
    id: "K7",
    alternative:
      "The one client is never registered with React Native or Expo, and Octave uses none of their clients (decision 0005). Send through `OctaveHttp.callFactory(session)`.",
    names: [
      ...K7_HOOKS.map((name) => ({ re: word(name), what: `React Native's or Expo's client hook ${name}` })),
      ...K7_PACKAGES.map((name) => ({ re: pkg(name), what: `${name}, which opens its own HTTP path` })),
    ],
  },
  {
    id: "K8",
    alternative: "The one client carries one interceptor, `SessionInterceptor`, and no network interceptor.",
    names: [
      { re: prefix("ExpoNetworkInspectOkHttp"), what: "Expo's network inspector" },
      { re: pkg("expo.modules.kotlin.devtools"), what: "Expo's network inspector" },
      { re: word("HttpLoggingInterceptor"), what: "a logging interceptor" },
      { re: call("addNetworkInterceptor"), what: "a network interceptor" },
    ],
  },
  {
    id: "K9",
    alternative: "A WebView cannot send the header (invariant I7). Draw with native views; fetch through `OctaveHttp.callFactory(session)`.",
    names: [{ re: word("WebView"), what: "a WebView" }],
  },
  {
    id: "K10",
    alternative: "Do not reach another module's `internal` members. Ask the session module for `OctaveHttp.callFactory(session)`.",
    names: [{ re: /(?<![A-Za-z0-9_$])INVISIBLE_(?:MEMBER|REFERENCE)(?![A-Za-z0-9_$])/, what: "a suppressed visibility check", inStrings: true }],
  },
];

const ruleById = new Map(KOTLIN_RULES.map((rule) => [rule.id, rule]));

// --- reading Kotlin and Java ------------------------------------------------------------------------------------

/**
 * Splits Kotlin or Java source into lines of code, with comments removed and each string literal's text moved out:
 * `code` keeps `""` where a string stood, `strings` holds the string texts that start on that line. With `templates`
 * (Kotlin, the default), the code of a `${...}` template is read as code, nested strings and braces included; Java has no
 * templates, so its strings are read as text throughout.
 */
export function splitSource(text, { templates = true } = {}) {
  const lines = [{ code: "", strings: [] }];
  let line = lines[0];
  const newline = () => {
    line = { code: "", strings: [] };
    lines.push(line);
  };
  let i = 0;

  // Reads a string literal from its opening quote. The text before and after a template goes to `strings`.
  const readString = () => {
    const raw = text.startsWith('"""', i);
    i += raw ? 3 : 1;
    line.code += '""';
    let body = "";
    while (i < text.length) {
      if (raw ? text.startsWith('"""', i) : text[i] === '"') break;
      if (!raw && text[i] === "\\") {
        body += text.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (templates && text[i] === "$" && text[i + 1] === "{") {
        line.strings.push(body);
        body = "";
        i += 2;
        line.code += " ";
        readCode(true);
        line.code += " ";
        continue;
      }
      if (!raw && text[i] === "\n") break; // an unterminated string ends at the line
      if (text[i] === "\n") {
        line.strings.push(body);
        body = "";
        newline();
      } else {
        body += text[i];
      }
      i += 1;
    }
    if (raw && text.startsWith('"""', i)) {
      i += 3;
      while (text[i] === '"') i += 1; // a raw string may end with more quotes; they are its text
    } else if (!raw && text[i] === '"') {
      i += 1;
    }
    line.strings.push(body);
  };

  // Reads code up to the end of the text, or, in a template, up to the `}` that closes it.
  const readCode = (inTemplate) => {
    let depth = 0;
    while (i < text.length) {
      const ch = text[i];
      const next = text[i + 1];
      if (inTemplate && ch === "{") {
        depth += 1;
        line.code += ch;
        i += 1;
      } else if (inTemplate && ch === "}") {
        i += 1;
        if (depth === 0) return;
        depth -= 1;
        line.code += ch;
      } else if (ch === "\n") {
        newline();
        i += 1;
      } else if (ch === "/" && next === "/") {
        while (i < text.length && text[i] !== "\n") i += 1;
      } else if (ch === "/" && next === "*") {
        i += 2;
        while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
          if (text[i] === "\n") newline();
          i += 1;
        }
        i += 2;
      } else if (ch === '"') {
        readString();
      } else if (ch === "'") {
        // A character literal: 'x', '\n', '\u0041'. Anything else is copied as code.
        const literal = /^'(?:\\u[0-9a-fA-F]{4}|\\.|[^'\\\n])'/.exec(text.slice(i, i + 9));
        if (literal) {
          line.code += "' '";
          i += literal[0].length;
        } else {
          line.code += ch;
          i += 1;
        }
      } else {
        line.code += ch;
        i += 1;
      }
    }
  };

  readCode(false);
  return lines;
}

// The dotted or slashed full names inside a string: `okhttp3.OkHttpClient`, `androidx/media3/datasource/X`.
const qualifiedNames = (string) => string.match(/[A-Za-z_][A-Za-z0-9_]*(?:[./$][A-Za-z_][A-Za-z0-9_]*)+/g) ?? [];

const message = (path, lineNumber, what, rule) => `ERROR network: ${path}:${lineNumber}: ${what}. ${rule.alternative}`;

function nameHits(name, code, strings) {
  if (name.re.test(code)) return true;
  if (name.inStrings) return strings.some((string) => name.re.test(string));
  // Only a full name holds in a string; a word ("the client refused it") does not.
  return strings.some((string) => qualifiedNames(string).some((full) => name.re.test(full)));
}

function scanKotlin(file) {
  const errors = [];
  const lines = splitSource(file.text, { templates: !file.path.endsWith(".java") });
  const report = (index, ruleId, what) => errors.push(message(file.path, index + 1, what, ruleById.get(ruleId)));
  const isOctaveHttp = file.path === OCTAVE_HTTP;
  const isDirectSockets = file.path === DIRECT_SOCKETS;
  const allCode = lines.map((line) => line.code).join("\n");
  const statesDataSource = /(?<![A-Za-z0-9_$])setDataSourceFactory\s*\(/.test(allCode);
  const statesMediaSources = /(?<![A-Za-z0-9_$])setMediaSourceFactory\s*\(/.test(allCode);
  let builders = 0;

  lines.forEach((line, index) => {
    const { code, strings } = line;
    const hit = new Set();
    const once = (ruleId, what) => {
      if (hit.has(ruleId)) return;
      hit.add(ruleId);
      report(index, ruleId, what);
    };
    for (const rule of KOTLIN_RULES) {
      for (const name of rule.names) {
        if ((name.socket && isDirectSockets) || (name.oneClient && isOctaveHttp)) continue;
        if (nameHits(name, code, strings)) once(rule.id, name.what);
      }
    }
    // K3 and K6: a default factory or builder in a file that states no source.
    if (!statesDataSource && nameHits({ re: word("DefaultMediaSourceFactory") }, code, strings)) {
      once("K3", "DefaultMediaSourceFactory with no stated data source");
    }
    const exoBuilder = /(?<![A-Za-z0-9_$])ExoPlayer\s*[.$]\s*Builder(?![A-Za-z0-9_$])/;
    if (!statesMediaSources && nameHits({ re: exoBuilder }, code, strings)) {
      once("K6", "ExoPlayer.Builder with no stated media source factory");
    }
    // K4: the one client lives in OctaveHttp.kt alone, with one builder, read as `.client` there alone.
    if (isOctaveHttp) {
      for (const _ of code.matchAll(/(?<![A-Za-z0-9_$])OkHttpClient\s*\.\s*Builder\s*\(/g)) {
        builders += 1;
        if (builders > 1) once("K4", "a second OkHttpClient.Builder");
      }
      if (/^\s*import\s+okhttp3\s*\.\s*OkHttpClient\s*(?:\.|as\b)/.test(code)) once("K4", "a member or alias import of OkHttpClient");
      for (const match of code.matchAll(/([A-Za-z0-9_$]+)\s*(?:\(\s*\))?\s*\.\s*newBuilder\s*\(/g)) {
        if (match[1] !== "request" && match[1] !== "response") once("K4", "a client derived with newBuilder()");
      }
    } else {
      if (nameHits({ re: word("OkHttpClient") }, code, strings)) once("K4", "an OkHttpClient outside OctaveHttp.kt");
      if (/\.\s*client(?![A-Za-z0-9_$])/.test(code)) once("K4", "a read of the one client outside OctaveHttp.kt");
    }
  });
  return errors;
}

// A config plugin is JavaScript that may write Kotlin into the generated project, read as plain text.
function scanPlugin(file) {
  const errors = [];
  const text = file.text;
  const lines = text.split("\n");
  const statesDataSource = /setDataSourceFactory\s*\(/.test(text);
  const statesMediaSources = /setMediaSourceFactory\s*\(/.test(text);
  lines.forEach((code, index) => {
    const hit = new Set();
    const once = (ruleId, what) => {
      if (hit.has(ruleId)) return;
      hit.add(ruleId);
      errors.push(message(file.path, index + 1, what, ruleById.get(ruleId)));
    };
    for (const rule of KOTLIN_RULES) {
      if (!PLUGIN_RULES.has(rule.id)) continue;
      for (const name of rule.names) if (name.re.test(code)) once(rule.id, name.what);
    }
    for (const name of PLUGIN_NAMES) if (name.re.test(code)) once(name.rule, name.what);
    if (!statesDataSource && word("DefaultMediaSourceFactory").test(code)) once("K3", "DefaultMediaSourceFactory with no stated data source");
    if (!statesMediaSources && /ExoPlayer\s*[.$]\s*Builder/.test(code)) once("K6", "ExoPlayer.Builder with no stated media source factory");
  });
  return errors;
}

/** Returns an `ERROR network: <path>:<line>: <what>. <alternative>` line for each violation in `files`. */
export function findSourceViolations(files) {
  return files.flatMap((file) => (file.path.startsWith("apps/tv/plugins/") ? scanPlugin(file) : scanKotlin(file)));
}

// --- the linked libraries (items 6 and 7) ------------------------------------------------------------------------

// A Gradle source set that ships: every folder under src/ but the test ones.
const shipsSourceSet = (name) => !/^(test|androidTest)/.test(name);

/**
 * Returns `true` when the Kotlin or Java `text` holds a form of NETWORK_OPENERS in code (a Kotlin template's code
 * included) or as a full name in a string. Pass `{ templates: false }` for Java.
 */
export function opensConnection(text, options) {
  return splitSource(text, options).some(({ code, strings }) => NETWORK_OPENERS.some((name) => nameHits(name, code, strings)));
}

/**
 * Lists each `.kt` and `.java` file of a package's Android source (`android/src/<set>` or `ReactAndroid/src/<set>`, every
 * set but the test ones, never `build/`) that matches NETWORK_OPENERS. `packages` is `{ name, dir }[]`.
 */
export function findLinkedClients(packages) {
  const found = [];
  for (const { name, dir } of packages) {
    for (const android of ["android", "ReactAndroid"]) {
      const src = join(dir, android, "src");
      if (!existsSync(src)) continue;
      for (const set of readdirSync(src).sort()) {
        if (!shipsSourceSet(set) || !statSync(join(src, set)).isDirectory()) continue;
        const files = walk(join(src, set), (file) => /\.(kt|java)$/.test(file), (_full, folder) => folder === "build", []);
        for (const full of files) {
          if (opensConnection(readFileSync(full, "utf8"), { templates: full.endsWith(".kt") })) found.push({ package: name, file: toPosix(relative(dir, full)) });
        }
      }
    }
  }
  return found;
}

/** Compares the inventory with the allowlist: an unlisted file, and an entry whose file no longer opens a connection. */
export function judgeLinkedClients(found, allowlist) {
  const key = (pkgName, file) => `${pkgName}\u0000${file}`;
  const listed = new Set(allowlist.map((entry) => key(entry.package, entry.file)));
  const seen = new Set(found.map((client) => key(client.package, client.file)));
  const errors = [];
  for (const client of found) {
    if (!listed.has(key(client.package, client.file))) {
      errors.push(
        `ERROR network: ${client.package}/${client.file} opens its own HTTP path and is not on LINKED_NETWORK_PATHS. Add an entry with its reason, and a rule that refuses it in Octave's code, or remove the dependency.`,
      );
    }
  }
  for (const entry of allowlist) {
    if (!seen.has(key(entry.package, entry.file))) {
      errors.push(`ERROR network: LINKED_NETWORK_PATHS entry ${entry.id} names ${entry.file}, which no longer opens an HTTP path. Remove or correct the entry.`);
    }
  }
  return errors;
}

// The folder of an installed package `name` as Node would find it from `fromDir`: <ancestor>/node_modules/<name>.
function findPackage(name, fromDir) {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", ...name.split("/"));
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    if (dirname(dir) === dir) return undefined;
  }
}

/**
 * The app's installed dependencies with their Android source: from apps/tv/package.json's `dependencies`, following
 * each package's `dependencies` and installed `peerDependencies`. A workspace package (not under node_modules) is not
 * listed, because the K rules read its source, but its dependencies are followed. Returns `{ packages: { name, dir }[], errors }`; a regular dependency that is
 * not installed is an error, never skipped.
 */
// The packages T3-19 item 3 may unlink from Android. No other package leaves the inventory, whatever the list says.
export const MAY_BE_UNLINKED = ["expo-file-system", "expo-asset", "@expo/log-box", "@expo/dom-webview"];

const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

// The names Android autolinking excludes, by Expo's override rule (expo-modules-autolinking 58.1.0,
// build/commands/autolinkingOptions.js, parsePackageJsonOptions): `expo.autolinking.android` is spread over
// `expo.autolinking`, so an `exclude` under `android` replaces the top-level one; a value that is not a list excludes
// nothing. Never a union of the two.
export function excludedOnAndroid(manifest) {
  const expo = isPlainObject(manifest) && isPlainObject(manifest.expo) ? manifest.expo : {};
  const autolinking = isPlainObject(expo.autolinking) ? expo.autolinking : {};
  const merged = { ...autolinking, ...(isPlainObject(autolinking.android) ? autolinking.android : {}) };
  const exclude = Array.isArray(merged.exclude) ? merged.exclude : [];
  return new Set(exclude.filter((name) => typeof name === "string"));
}

export function linkedPackages(root) {
  const appManifest = join(root, "apps", "tv", "package.json");
  const errors = [];
  if (!existsSync(appManifest)) return { packages: [], errors: [`ERROR network: found no app manifest at apps/tv/package.json`] };
  const app = JSON.parse(readFileSync(appManifest, "utf8"));
  const excluded = excludedOnAndroid(app);
  // An unlinked package's own native code is not in the APK, but its dependencies may be linked through another path.
  const unlinked = new Set(MAY_BE_UNLINKED.filter((name) => excluded.has(name)));
  const seen = new Set();
  const packages = [];
  const queue = [{ dir: join(root, "apps", "tv"), manifest: app, app: true }];
  while (queue.length > 0) {
    const { dir, manifest, app } = queue.shift();
    const wanted = [
      ...Object.keys(manifest.dependencies ?? {}).map((name) => ({ name, peer: false })),
      ...Object.keys(manifest.peerDependencies ?? {}).map((name) => ({ name, peer: true })),
    ];
    for (const { name, peer } of wanted) {
      const found = findPackage(name, dir);
      if (!found) {
        const optional = peer || manifest.optionalDependencies?.[name] !== undefined;
        if (!optional) errors.push(`ERROR network: ${app ? "apps/tv" : manifest.name} depends on ${name}, which is not installed`);
        continue;
      }
      if (seen.has(found)) continue;
      seen.add(found);
      // A workspace package's own source is read by the K rules, but its dependencies are linked into the app too.
      if (found.split(sep).includes("node_modules") && !unlinked.has(name)) packages.push({ name, dir: found });
      queue.push({ dir: found, manifest: JSON.parse(readFileSync(join(found, "package.json"), "utf8")), app: false });
    }
  }
  return { packages: packages.filter((pkg) => existsSync(join(pkg.dir, "android")) || existsSync(join(pkg.dir, "ReactAndroid"))), errors };
}

// --- the command --------------------------------------------------------------------------------------------------

const toPosix = (path) => path.split("\\").join("/");

function walk(dir, keep, skip, out) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!skip(full, name)) walk(full, keep, skip, out);
    } else if (keep(name)) {
      out.push(full);
    }
  }
  return out;
}

/** Octave's Kotlin and Java (outside tests and build output) and the config plugins, as `{ path, text }` relative to `root`. */
export function readOctaveSource(root) {
  const skip = (full, name) => name === "build" || name === "node_modules" || toPosix(full).endsWith("/src/test");
  const kotlinOrJava = (name) => /\.(kt|java)$/.test(name);
  const paths = [];
  const modules = join(root, "modules");
  if (existsSync(modules)) {
    for (const module of readdirSync(modules).sort()) walk(join(modules, module, "android", "src"), kotlinOrJava, skip, paths);
  }
  walk(join(root, "apps", "tv", "native"), kotlinOrJava, skip, paths);
  walk(join(root, "apps", "tv", "plugins"), (name) => name.endsWith(".js"), skip, paths);
  return paths.map((full) => ({ path: toPosix(relative(root, full)), text: readFileSync(full, "utf8") }));
}

export function main(args = process.argv.slice(2)) {
  const at = args.indexOf("--root");
  const root = at === -1 ? fileURLToPath(new URL("..", import.meta.url)) : args[at + 1];
  const errors = [];
  if (at !== -1 && !root) errors.push("ERROR network: --root needs a directory");
  const files = root ? readOctaveSource(root) : [];
  const kotlin = files.filter((file) => !file.path.startsWith("apps/tv/plugins/"));
  errors.push(...findSourceViolations(files));
  if (kotlin.length === 0) errors.push("ERROR network: read no Octave Kotlin or Java source; a run with nothing to read never passes");
  if (!files.some((file) => file.path === OCTAVE_HTTP)) errors.push(`ERROR network: did not read ${OCTAVE_HTTP}, the one client`);
  const linked = root ? linkedPackages(root) : { packages: [], errors: [] };
  errors.push(...linked.errors);
  const found = findLinkedClients(linked.packages);
  if (linked.packages.length === 0) errors.push("ERROR network: found no linked package with Android source; a run with nothing to read never passes");
  else errors.push(...judgeLinkedClients(found, LINKED_NETWORK_PATHS));
  console.log(`network: ${files.length} Octave files, ${found.length} linked files, ${errors.length} violations`);
  for (const error of errors) console.error(error);
  return errors.length === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
