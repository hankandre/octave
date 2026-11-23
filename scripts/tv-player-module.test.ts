// @vitest-environment node
// T8-01 (docs/specs/T8-01.md): the player module's package, Gradle file and loaders (item 1), its native view
// (item 5) and the plain-Kotlin seam a Swift engine can mirror (item 6). Source scans only: nothing here loads the
// module, and whether the view draws a frame on a device is T8-02's.
//
// The contract frozen here:
// - modules/player is the workspace package @octave/player (private, GPL-3.0-only, main src/index.ts), a dependency
//   of @octave/tv as "workspace:*". expo-module.config.json names dev.octave.player.OctavePlayerModule for Android
//   only. android/build.gradle has namespace dev.octave.player, the JUnit BOM pin modules/session uses,
//   project(':octave-session'), the octave.repoRoot system property, and no Media3, Robolectric or
//   logging-interceptor line.
// - apps/tv/src/host/player-module.android.ts is the one app file that calls requireNativeModule for "OctavePlayer",
//   and player-view.android.tsx the one that calls requireNativeViewManager for it; each has a sibling without the
//   .android suffix.
// - Item 5: the module's View block defines nothing but the view (lifecycle hooks only). OctavePlayerView is an
//   ExpoView holding a SurfaceView and handing its surface to VideoSurfaceSlot. Neither those two Kotlin files nor
//   the view's TypeScript files hold an identifier with a word url, uri, source or src (camelCase words, any case),
//   and the TypeScript view is typed Pick<ViewProps, "style">.
// - Item 6: every Kotlin file in dev.octave.player.seam imports nothing from android, androidx, expo, okhttp3 or
//   com.facebook, and from modules/session only dev.octave.session.http.SessionId. PlaybackEngine is an interface
//   with exactly seven functions. No media3, exoplayer or exo word, in any case, is in modules/player/src, the app's
//   player-* host files or modules/player/package.json, and no media3 in the Gradle file.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

const MAIN = "modules/player/android/src/main/java/dev/octave/player";
const SEAM = `${MAIN}/seam`;
const MODULE_FILE = `${MAIN}/OctavePlayerModule.kt`;
const VIEW_KT = [`${MAIN}/OctavePlayerView.kt`, `${MAIN}/VideoSurfaceSlot.kt`];
const VIEW_TS = ["apps/tv/src/host/player-view.android.tsx", "apps/tv/src/host/player-view.tsx"];
const HOST_PLAYER_FILES = [
  "apps/tv/src/host/player-engine.ts",
  "apps/tv/src/host/player-module.android.ts",
  "apps/tv/src/host/player-module.ts",
  ...VIEW_TS,
];
const SEAM_FILES = [
  "PlaybackEngine.kt",
  "LaunchRequest.kt",
  "LaunchRequestReader.kt",
  "PlayerEvent.kt",
  "PlayerEventMaps.kt",
  "Capabilities.kt",
  "PlayerErrorCode.kt",
  "PlayerSeam.kt",
];

function read(path: string): string {
  expect(existsSync(join(repo, path)), `${path} exists`).toBe(true);
  return readFileSync(join(repo, path), "utf8");
}

const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, "");

function filesUnder(dir: string, pattern: RegExp): string[] {
  const absolute = join(repo, dir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute).flatMap((name) => {
    const path = join(absolute, name);
    if (statSync(path).isDirectory()) return filesUnder(relative(repo, path), pattern);
    return pattern.test(name) ? [relative(repo, path)] : [];
  });
}

// The body of the block that opens at the first `{` at or after `from`.
function blockFrom(code: string, from: number): string {
  const open = code.indexOf("{", from);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    if (code[i] === "}") depth -= 1;
    if (depth === 0) return code.slice(open + 1, i);
  }
  return code.slice(open + 1);
}

// The calls at the top level of a block body: an identifier, not after a dot, followed by ( or {.
function topLevelCallNames(body: string): string[] {
  const names: string[] = [];
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c === "(" || c === "{" || c === "[") depth += 1;
    else if (c === ")" || c === "}" || c === "]") depth -= 1;
    else if (depth === 0 && /[A-Za-z_]/.test(c) && !/[\w.]/.test(body[i - 1] ?? " ")) {
      const match = /^([A-Za-z_]\w*)\s*[({]/.exec(body.slice(i));
      const word = /^[A-Za-z_]\w*/.exec(body.slice(i))?.[0] ?? c;
      if (match && !body.slice(0, i).trimEnd().endsWith(".")) names.push(match[1]);
      i += word.length - 1;
    }
  }
  return names;
}

// The calls at the top level of the module's View(...) block, or null when there is no View(...::class).
function viewBlockCalls(source: string): string[] | null {
  const code = withoutComments(source);
  const view = /\bView\s*\(\s*(\w+)\s*::\s*class\s*\)/.exec(code);
  if (!view) return null;
  const after = code.slice(view.index + view[0].length);
  if (!/^\s*\{/.test(after)) return [];
  return topLevelCallNames(blockFrom(after, 0));
}

function viewBlockProblems(source: string): string[] {
  const calls = viewBlockCalls(source);
  if (calls === null) return ["no View(…::class) in the module definition"];
  return calls.filter((name) => !/^On[A-Z]/.test(name)).map((name) => `${name} in the view block`);
}

// Every identifier's words: camelCase, PascalCase and snake_case split, lower-cased.
function identifierWords(code: string): string[] {
  return [...code.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)].flatMap((match) =>
    match[0]
      .split("_")
      .flatMap((part) => part.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/))
      .filter((word) => word !== "")
      .map((word) => word.toLowerCase()),
  );
}

const ADDRESS_WORDS = ["url", "uri", "source", "src"];

describe("the player module package", () => {
  it("T8-01 item 1: modules/player is the workspace package @octave/player, a dependency of the TV app", () => {
    const pkg = JSON.parse(read("modules/player/package.json")) as Record<string, unknown>;
    expect(pkg.name).toBe("@octave/player");
    expect(pkg.private).toBe(true);
    expect(pkg.license).toBe("GPL-3.0-only");
    expect(pkg.main).toBe("src/index.ts");
    expect(pkg.dependencies ?? {}, "the package adopts no dependency").toEqual({});
    const app = JSON.parse(read("apps/tv/package.json")) as { dependencies: Record<string, string> };
    expect(app.dependencies["@octave/player"]).toBe("workspace:*");
  });

  it("T8-01 item 1: the Expo config names the module class for Android only, and the class exists", () => {
    const config = JSON.parse(read("modules/player/expo-module.config.json")) as { platforms: string[]; android: { modules: string[] } };
    expect(config.platforms).toEqual(["android"]);
    expect(config.android.modules).toEqual(["dev.octave.player.OctavePlayerModule"]);
    expect(withoutComments(read(MODULE_FILE))).toMatch(/\bclass\s+OctavePlayerModule\s*:\s*Module\s*\(\s*\)/);
  });

  it("T8-01 item 1: the Gradle file has the namespace, the JUnit BOM pin, the session project and no player library", () => {
    const gradle = read("modules/player/android/build.gradle");
    const code = withoutComments(gradle);
    expect(code).toMatch(/namespace\s*=?\s*["']dev\.octave\.player["']/);
    const sessionBom = /org\.junit:junit-bom:[\d.]+/.exec(read("modules/session/android/build.gradle"))?.[0];
    expect(sessionBom, "modules/session pins a JUnit BOM").toBeDefined();
    expect(code, "the same JUnit BOM pin as modules/session").toContain(sessionBom ?? "junit-bom");
    expect(code).toMatch(/project\s*\(\s*["']:octave-session["']\s*\)/);
    expect(code).toMatch(/systemProperty\s*\(?\s*["']octave\.repoRoot["']/);
    for (const word of [/media3/i, /robolectric/i, /logging-interceptor/i]) expect(gradle, `build.gradle names ${word}`).not.toMatch(word);
  });

  it("T8-01 item 1: the loaders are the only app files that name the native module", () => {
    const sources = filesUnder("apps/tv/src", /\.(ts|tsx)$/).map((path) => ({ path, code: withoutComments(readFileSync(join(repo, path), "utf8")) }));
    const naming = (call: string) =>
      sources.filter(({ code }) => new RegExp(`\\b${call}\\b[^;(]*\\(\\s*["']OctavePlayer["']`).test(code)).map(({ path }) => path);
    expect(naming("requireNativeModule")).toEqual(["apps/tv/src/host/player-module.android.ts"]);
    expect(naming("requireNativeViewManager")).toEqual(["apps/tv/src/host/player-view.android.tsx"]);
    for (const path of ["apps/tv/src/host/player-module.ts", "apps/tv/src/host/player-view.tsx"]) {
      expect(read(path), `${path} throws a fixed sentence`).toMatch(/throw new Error\(\s*"[^"]+"\s*\)/);
    }
  });
});

describe("the player view", () => {
  it("T8-01 item 5: the module's view block defines nothing but the view", () => {
    const source = read(MODULE_FILE);
    expect(viewBlockProblems(source)).toEqual([]);
    expect(withoutComments(source)).toMatch(/\bView\s*\(\s*OctavePlayerView\s*::\s*class\s*\)/);
    expect((withoutComments(source).match(/\bView\s*\(/g) ?? []).length, "one view").toBe(1);
  });

  it("T8-01 item 5: a planted Prop, event or function in the view block fails the check", () => {
    const source = read(MODULE_FILE);
    const plantIn = (line: string) => {
      const match = /View\s*\(\s*OctavePlayerView\s*::\s*class\s*\)\s*\{/.exec(source);
      if (match) return source.slice(0, match.index + match[0].length) + `\n      ${line}\n` + source.slice(match.index + match[0].length);
      return source.replace(/View\s*\(\s*OctavePlayerView\s*::\s*class\s*\)/, `View(OctavePlayerView::class) {\n      ${line}\n    }`);
    };
    for (const line of ['Prop("url") { view: OctavePlayerView, url: String -> }', 'Events("onLoad")', 'AsyncFunction("play") { view: OctavePlayerView -> }']) {
      const planted = plantIn(line);
      expect(planted, `the plant of ${line} went in`).not.toBe(source);
      expect(viewBlockProblems(planted), `the check sees ${line}`).not.toEqual([]);
    }
  });

  it("T8-01 item 5: OctavePlayerView is an ExpoView holding a SurfaceView that it hands to VideoSurfaceSlot", () => {
    const view = withoutComments(read(`${MAIN}/OctavePlayerView.kt`));
    expect(view).toMatch(/\bclass\s+OctavePlayerView\b[^{]*:\s*ExpoView\s*\(/);
    expect(view).toMatch(/\bSurfaceView\s*\(/);
    expect(view).toContain("VideoSurfaceSlot");
    expect(withoutComments(read(`${MAIN}/VideoSurfaceSlot.kt`))).toMatch(/\b(object|class)\s+VideoSurfaceSlot\b/);
  });

  it("T8-01 item 5: the view's Kotlin and TypeScript hold no url, uri, source or src identifier", () => {
    for (const path of [...VIEW_KT, ...VIEW_TS]) {
      const words = identifierWords(withoutComments(read(path)));
      expect(words.length, `${path} was read`).toBeGreaterThan(0);
      expect(words.filter((word) => ADDRESS_WORDS.includes(word)), `address words in ${path}`).toEqual([]);
    }
    expect(identifierWords("sourceUrl mediaURI imageSrc"), "the word split sees camelCase").toEqual(["source", "url", "media", "uri", "image", "src"]);
  });

  it("T8-01 item 5: the TypeScript view takes style only", () => {
    const code = withoutComments(read("apps/tv/src/host/player-view.android.tsx"));
    expect(code).toMatch(/Pick<\s*ViewProps\s*,\s*["']style["']\s*>/);
  });
});

describe("the seam a Swift engine can mirror", () => {
  it("T8-01 item 6: the seam package imports nothing from Android, Expo, OkHttp or React Native, and only SessionId from the session module", () => {
    for (const name of SEAM_FILES) expect(existsSync(join(repo, SEAM, name)), `${SEAM}/${name} exists`).toBe(true);
    const files = filesUnder(SEAM, /\.(kt|java)$/);
    expect(files.length).toBeGreaterThanOrEqual(SEAM_FILES.length);
    for (const path of files) {
      const code = withoutComments(readFileSync(join(repo, path), "utf8"));
      const imports = [...code.matchAll(/^\s*import\s+([\w.]+)/gm)].map((match) => match[1]);
      for (const name of imports) {
        expect(name, `${path} imports ${name}`).not.toMatch(/^(android|androidx|expo|okhttp3|com\.facebook)\./);
        if (name.startsWith("dev.octave.session.")) expect(name, `${path} takes only SessionId from the session module`).toBe("dev.octave.session.http.SessionId");
      }
      const body = code.replace(/^\s*(package|import)\s+.*$/gm, "");
      expect(body, `${path} names a platform class in full`).not.toMatch(/\b(android|androidx|expo|okhttp3|com\.facebook)\.[a-z]/);
    }
  });

  it("T8-01 item 6: PlaybackEngine is an interface with exactly the port's seven members", () => {
    const code = withoutComments(read(`${SEAM}/PlaybackEngine.kt`));
    const start = /\binterface\s+PlaybackEngine\b/.exec(code);
    expect(start, "PlaybackEngine is an interface").not.toBeNull();
    expect(code.slice(start?.index ?? 0).split("{")[0], "no supertype").not.toContain(":");
    const body = blockFrom(code, start?.index ?? 0);
    let depth = 0;
    const members: string[] = [];
    for (const line of body.split("\n")) {
      if (depth === 0) {
        const fun = /^\s*fun\s+(\w+)\s*\(/.exec(line);
        if (fun) members.push(fun[1]);
        expect(line, "no property member").not.toMatch(/^\s*(val|var)\s/);
      }
      for (const char of line) {
        if (char === "(" || char === "{" || char === "[") depth += 1;
        if (char === ")" || char === "}" || char === "]") depth -= 1;
      }
    }
    expect([...members].sort()).toEqual(["capabilities", "launch", "seek", "selectTrack", "setListener", "setPaused", "stop"]);
  });

  it("T8-01 item 6: nothing on the TypeScript side or in the package names Media3", () => {
    const paths = [...filesUnder("modules/player/src", /./), ...HOST_PLAYER_FILES, "modules/player/package.json"];
    expect(paths).toContain("modules/player/src/index.ts");
    for (const path of paths) {
      const text = read(path);
      expect(text, `${path} names Media3`).not.toMatch(/media3|exoplayer|\bexo\b/i);
    }
    const hostPlayerFiles = filesUnder("apps/tv/src/host", /^player-/);
    for (const path of hostPlayerFiles) expect(readFileSync(join(repo, path), "utf8"), `${path} names Media3`).not.toMatch(/media3|exoplayer|\bexo\b/i);
    expect(read("modules/player/android/build.gradle")).not.toMatch(/media3/i);
  });
});
