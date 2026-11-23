// @vitest-environment node
// T8-02 item 1 (docs/specs/T8-02.md, "The engine's build"): an original-file launch plays through an ExoPlayer built
// only with Octave's media source factory over the one OkHttp client, on the player view's SurfaceView. Source scans
// of modules/player/android/src/main and the Gradle and manifest files; the play itself is the wire test
// player-original-file (item 7, gate: ci).
//
// The contract frozen here (comments are stripped before every scan):
// - Exactly one `ExoPlayer.Builder(` in the module's main Kotlin, in media3/Media3Engine.kt or media3/Media3Handle.kt;
//   the call has three arguments and is followed by `.setMediaSourceFactory(`.
// - Exactly one `OkHttpDataSource.Factory(` in the module, in a file of package dev.octave.player.media3 (the one
//   package the dex and K7 exception allow: Product Owner ruling of 2026-11-23); its argument starts with
//   `OctaveHttp.callFactory(` and nothing is chained on the call. `OkHttpDataSource` is named nowhere else but its
//   import, so no field, parameter, return, cast or type check names the class (spec check issue 11; the engine
//   holds the value as DataSource.Factory).
// - `ProgressiveMediaSource.Factory(` and `Log.setLogLevel(Log.LOG_LEVEL_OFF)` are there; no default or other data
//   source, media source factory, header, user-agent, logger or setter of OkHttpDataSource.Factory is named.
// - `setVideoSurface(` is called only in media3/Media3Handle.kt, and no other video output is named; Media3Engine.kt
//   names VideoSurfaceSlot (its listener is where the surface comes from).
// - engine/ is plain Kotlin: no android, androidx, expo, okhttp3 or com.facebook import.
// - build.gradle: media3Version '1.11.1', equal to MEDIA3_VERSION in apps/tv/plugins/with-app-jvm-tests.js;
//   okhttpVersion equal to modules/session's; the main dependencies are exactly project(':octave-session'), the
//   OkHttp BOM at okhttpVersion, media3-exoplayer and media3-datasource-okhttp at media3Version, and the file names
//   no other androidx.media3 or com.squareup.okhttp3 artifact (the condition of the 2026-11-23 frozen-test ruling).
// - The plugin adds both Media3 artifacts to :app's tests at MEDIA3_VERSION.
// - The module's AndroidManifest.xml removes ACCESS_NETWORK_STATE and WAKE_LOCK with tools:node="remove" (D9).
// - OctavePlayerModule.kt hands PlayerSeam an engine: no `PlayerSeam(null`, and `Media3Engine(` is named there.
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const MAIN = "modules/player/android/src/main/java/dev/octave/player";
const ENGINE_DIR = `${MAIN}/engine`;
const MEDIA3_DIR = `${MAIN}/media3`;
const GRADLE = "modules/player/android/build.gradle";
const SESSION_GRADLE = "modules/session/android/build.gradle";
const MANIFEST = "modules/player/android/src/main/AndroidManifest.xml";
const MODULE_FILE = `${MAIN}/OctavePlayerModule.kt`;
const PLUGIN = "apps/tv/plugins/with-app-jvm-tests.js";

function read(path: string): string {
  expect(existsSync(join(repo, path)), `${path} exists`).toBe(true);
  return readFileSync(join(repo, path), "utf8");
}

const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, "");
const withoutImports = (text: string) => text.replace(/^\s*import\s+[^\n]*$/gm, "");

function filesUnder(dir: string, pattern: RegExp): string[] {
  const absolute = join(repo, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute).flatMap((name) => {
    const path = join(absolute, name);
    if (statSync(path).isDirectory()) return filesUnder(relative(repo, path), pattern);
    return pattern.test(name) ? [relative(repo, path)] : [];
  });
}

// The module's main Kotlin and Java, comments stripped, by repository path.
function mainCode(): Map<string, string> {
  const files = filesUnder(MAIN, /\.(kt|java)$/);
  expect(files.length, "modules/player main sources found").toBeGreaterThan(5);
  return new Map(files.map((path) => [path, withoutComments(readFileSync(join(repo, path), "utf8"))]));
}

// Every match of `pattern` (global) across the main code, as { path, index }.
function matches(code: Map<string, string>, pattern: RegExp): { path: string; index: number; text: string }[] {
  return [...code].flatMap(([path, text]) => [...text.matchAll(pattern)].map((m) => ({ path, index: m.index ?? 0, text })));
}

// The text between the parenthesis that opens at `open` and its match, and the index after the closing one.
function argumentsAt(text: string, open: number): { inner: string; end: number } {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "(" || text[i] === "{" || text[i] === "[") depth += 1;
    if (text[i] === ")" || text[i] === "}" || text[i] === "]") depth -= 1;
    if (depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 };
  }
  return { inner: text.slice(open + 1), end: text.length };
}

function topLevelArgumentCount(inner: string): number {
  if (inner.trim() === "") return 0;
  let depth = 0;
  let count = 1;
  for (const c of inner) {
    if (c === "(" || c === "{" || c === "[" || c === "<") depth += 1;
    else if (c === ")" || c === "}" || c === "]" || c === ">") depth -= 1;
    else if (c === "," && depth === 0) count += 1;
  }
  return count;
}

function gradleDef(path: string, name: string): string {
  const match = new RegExp(`def\\s+${name}\\s*=\\s*['"]([^'"]+)['"]`).exec(withoutComments(read(path)));
  expect(match, `${path} has def ${name}`).not.toBeNull();
  return match?.[1] ?? "";
}

// The body of the top-level `dependencies { ... }` block.
function dependenciesBlock(gradle: string): string {
  const start = /^dependencies\s*\{/m.exec(gradle);
  expect(start, "build.gradle has a dependencies block").not.toBeNull();
  const open = gradle.indexOf("{", start?.index ?? 0);
  let depth = 0;
  for (let i = open; i < gradle.length; i += 1) {
    if (gradle[i] === "{") depth += 1;
    if (gradle[i] === "}") depth -= 1;
    if (depth === 0) return gradle.slice(open + 1, i);
  }
  return gradle.slice(open + 1);
}

const normalise = (line: string) => line.trim().replace(/'/g, '"').replace(/\s+/g, " ").replace(/\(\s*/g, "(").replace(/\s*\)/g, ")");

describe("T8-02 item 1: the engine builds one ExoPlayer over Octave's media source factory and the one client", () => {
  it("T8-02 item 1: exactly one ExoPlayer.Builder, with three arguments, followed by setMediaSourceFactory, in media3/", () => {
    const code = mainCode();
    const builders = matches(code, /\bExoPlayer\s*\.\s*Builder\s*\(/g);
    expect(builders.map((m) => m.path), "ExoPlayer.Builder( calls").toHaveLength(1);
    const [builder] = builders;
    expect([`${MEDIA3_DIR}/Media3Engine.kt`, `${MEDIA3_DIR}/Media3Handle.kt`]).toContain(builder.path);
    const open = builder.text.indexOf("(", builder.index);
    const { inner, end } = argumentsAt(builder.text, open);
    expect(topLevelArgumentCount(inner), "ExoPlayer.Builder(context, renderers, mediaSources)").toBe(3);
    expect(builder.text.slice(end)).toMatch(/^\s*\.\s*setMediaSourceFactory\s*\(/);
  });

  it("T8-02 item 1: exactly one OkHttpDataSource.Factory, over OctaveHttp.callFactory, with nothing set on it, in dev.octave.player.media3", () => {
    const code = mainCode();
    const factories = matches(code, /\bOkHttpDataSource\s*\.\s*Factory\s*\(/g);
    expect(factories.map((m) => m.path), "OkHttpDataSource.Factory( calls").toHaveLength(1);
    const [factory] = factories;
    expect(factory.path.startsWith(`${MEDIA3_DIR}/`), `${factory.path} is under media3/`).toBe(true);
    expect(factory.text).toMatch(/^\s*package\s+dev\.octave\.player\.media3\s*$/m);
    const open = factory.text.indexOf("(", factory.index);
    const { inner, end } = argumentsAt(factory.text, open);
    expect(inner.trim()).toMatch(/^OctaveHttp\s*\.\s*callFactory\s*\(/);
    expect(topLevelArgumentCount(inner)).toBe(1);
    expect(factory.text.slice(end), "nothing is chained on the factory").not.toMatch(/^\s*\??\.\s*[A-Za-z]/);
  });

  it("T8-02 item 1: OkHttpDataSource is named only by its import and the one constructor call", () => {
    const code = mainCode();
    const named = [...code].flatMap(([path, text]) => [...withoutImports(text).matchAll(/\bOkHttpDataSource\b/g)].map(() => path));
    expect(named, "every OkHttpDataSource outside an import").toHaveLength(1);
    for (const [path, text] of code) {
      expect(text, `${path}: a type, cast or check names OkHttpDataSource`).not.toMatch(/(?::|\bas\??|\bis|<)\s*(?:androidx\.media3\.datasource\.okhttp\.)?OkHttpDataSource\b/);
      expect(text, `${path}: a class literal of OkHttpDataSource`).not.toMatch(/OkHttpDataSource(?:\s*\.\s*Factory)?\s*::\s*class/);
    }
  });

  it("T8-02 item 1: Octave's media source factory is ProgressiveMediaSource, and Media3's logging is off", () => {
    const all = [...mainCode().values()].join("\n");
    expect(all).toMatch(/\bProgressiveMediaSource\s*\.\s*Factory\s*\(/);
    expect(all).toMatch(/\bLog\s*\.\s*setLogLevel\s*\(\s*Log\s*\.\s*LOG_LEVEL_OFF\s*\)/);
  });

  it("T8-02 item 1: no default or other data source, media source factory, header, user agent, logger or factory setter", () => {
    const forbidden = [
      "DefaultMediaSourceFactory",
      "DefaultDataSource",
      "DefaultDataSourceFactory",
      "DefaultHttpDataSource",
      "HttpEngineDataSource",
      "UdpDataSource",
      "Rtsp",
      "Rtmp",
      "Cronet",
      "HlsMediaSource",
      "DashMediaSource",
      "SsMediaSource",
      "setDefaultRequestProperties",
      "setRequestProperty",
      "setUserAgent",
      "setCacheControl",
      "setContentTypePredicate",
      "setTransferListener",
      "createDataSource",
      "httpRequestHeaders",
      "setRequestHeaders",
      "setLogger",
      "EventLogger",
    ];
    for (const [path, text] of mainCode()) {
      for (const word of forbidden) expect(text.includes(word), `${path} names ${word}`).toBe(false);
    }
  });

  it("T8-02 item 1: the video output is set only in Media3Handle, from VideoSurfaceSlot's listener in Media3Engine", () => {
    const code = mainCode();
    const surfaces = matches(code, /\bsetVideoSurface\s*\(/g).map((m) => m.path);
    expect(surfaces.length, "setVideoSurface( calls").toBeGreaterThan(0);
    expect(new Set(surfaces)).toEqual(new Set([`${MEDIA3_DIR}/Media3Handle.kt`]));
    for (const [path, text] of code) {
      expect(text, `${path} names another video output`).not.toMatch(/\b(?:setVideoSurfaceView|setVideoSurfaceHolder|setVideoTextureView|TextureView|clearVideoSurfaceView)\b/);
    }
    expect(code.get(`${MEDIA3_DIR}/Media3Engine.kt`) ?? "", "Media3Engine.kt exists and names VideoSurfaceSlot").toMatch(/\bVideoSurfaceSlot\s*\.\s*setListener\s*\(/);
  });

  it("T8-02 item 1: engine/ is plain Kotlin with no Android, AndroidX, Expo, OkHttp or React Native import", () => {
    const files = filesUnder(ENGINE_DIR, /\.kt$/);
    const names = files.map((path) => path.split("/").pop());
    for (const expected of ["EngineCore.kt", "PlayerHandle.kt", "EngineSignal.kt", "PlaybackErrors.kt", "DecoderFacts.kt"]) {
      expect(names, `engine/ holds ${expected}`).toContain(expected);
    }
    for (const path of files) {
      const imports = [...readFileSync(join(repo, path), "utf8").matchAll(/^\s*import\s+([\w.]+)/gm)].map((m) => m[1]);
      for (const name of imports) {
        expect(/^(android|androidx|expo|okhttp3|com\.facebook)\./.test(name), `${path} imports ${name}`).toBe(false);
      }
    }
  });

  it("T8-02 item 1: build.gradle adds exactly the two Media3 artifacts and the OkHttp BOM at the session module's pin", () => {
    expect(gradleDef(GRADLE, "media3Version")).toBe("1.11.1");
    expect(gradleDef(GRADLE, "okhttpVersion")).toBe(gradleDef(SESSION_GRADLE, "okhttpVersion"));
    const gradle = withoutComments(read(GRADLE));
    const main = dependenciesBlock(gradle)
      .split("\n")
      .map(normalise)
      .filter((line) => /^(implementation|api|compileOnly|runtimeOnly)\b/.test(line));
    expect(new Set(main)).toEqual(
      new Set([
        'implementation project(":octave-session")',
        'implementation platform("com.squareup.okhttp3:okhttp-bom:${okhttpVersion}")',
        'implementation "androidx.media3:media3-exoplayer:${media3Version}"',
        'implementation "androidx.media3:media3-datasource-okhttp:${media3Version}"',
      ]),
    );
    expect(main).toHaveLength(4);
    expect(gradle.match(/androidx\.media3:/g) ?? [], "androidx.media3 artifacts named").toHaveLength(2);
    expect(gradle.match(/com\.squareup\.okhttp3:/g) ?? [], "com.squareup.okhttp3 artifacts named").toHaveLength(1);
  });

  it("T8-02 item 1: the player's media3Version equals the JVM-tests plugin's MEDIA3_VERSION, and the plugin adds both artifacts to :app's tests", () => {
    const source = read(PLUGIN);
    const pinned = /\bMEDIA3_VERSION\s*=\s*["']([^"']+)["']/.exec(source)?.[1];
    expect(pinned, `${PLUGIN} defines MEDIA3_VERSION`).toBeDefined();
    expect(pinned).toBe(gradleDef(GRADLE, "media3Version"));
    const plugin = require(join(repo, PLUGIN)) as { addAppTests: (contents: string) => string };
    const block = plugin.addAppTests("dependencies {\n}\n");
    for (const artifact of ["media3-exoplayer", "media3-datasource-okhttp"]) {
      expect(block).toMatch(new RegExp(`testImplementation\\s*\\(?\\s*["']androidx\\.media3:${artifact}:${pinned?.replace(/\./g, "\\.")}["']`));
    }
  });

  it("T8-02 item 1: the module's manifest removes Media3's two permissions", () => {
    const manifest = read(MANIFEST);
    expect(manifest).toMatch(/xmlns:tools="http:\/\/schemas\.android\.com\/tools"/);
    for (const permission of ["android.permission.ACCESS_NETWORK_STATE", "android.permission.WAKE_LOCK"]) {
      const element = new RegExp(`<uses-permission\\b[^>]*android:name="${permission.replace(/\./g, "\\.")}"[^>]*>`).exec(manifest)?.[0] ?? "";
      expect(element, `${permission} is declared for removal`).not.toBe("");
      expect(element).toMatch(/tools:node="remove"/);
    }
  });

  it("T8-02 item 1: OctavePlayerModule hands PlayerSeam the Media3 engine", () => {
    const module = withoutComments(read(MODULE_FILE));
    expect(module).not.toMatch(/PlayerSeam\s*\(\s*null\b/);
    expect(module).toMatch(/PlayerSeam\s*\(\s*Media3Engine\s*\(/);
  });
});
