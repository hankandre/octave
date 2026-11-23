// @vitest-environment node
// T3-11 acceptance item 1 (docs/specs/T3-11.md, "The JavaScript surface" and "The native module"): an image view takes
// only an item id, an image type, a tag, a size and a session id from React, and no URL, header or token. Since T3-39
// (decision 0005, the BlurHash prop) it also takes a sixth prop, blurHash, the hash string only. Source scans
// only: nothing here loads the module. ModuleSurfaceTest (modules/artwork, JVM) holds the Kotlin definition the same
// way, and apps/tv/src/host/native-artwork.test.tsx the props the view receives.
//
// The contract frozen here:
// - modules/artwork/android/src/main/java/dev/octave/artwork/OctaveArtworkModule.kt has one `ModuleDefinition { }`
//   whose top-level calls are only `Name("OctaveArtwork")`, one `View(OctaveArtworkView::class) { … }` and an optional
//   `OnDestroy`. The view's block holds exactly the six `Prop`s session, itemId, imageType, tag, width and blurHash, one
//   `Events("onArtworkState")` and On… lifecycle hooks. Anywhere in the file's code an AsyncFunction, a Function, a
//   Property, a Constant or Constants, a PropGroup, a static function, a Class, a GroupView, an OnCreate, a sendEvent
//   or a Prop outside the view fails.
// - modules/artwork/surface-allowlist.json is exactly { module: "OctaveArtwork", functions: [], events: [], views:
//   [{ name: "OctaveArtworkView", props: [session, itemId, imageType, tag, width, blurHash], events: ["onArtworkState"] }],
//   pending: {} }.
// - docs/security.md has exactly one line starting `Artwork module allowlist:` (a list marker before it is allowed).
//   Its backticked names, apart from the module name `OctaveArtwork` and task ids, are exactly the view, its six
//   props and its event.
// - modules/artwork/src/index.ts declares `interface OctaveArtworkViewProps` with exactly session, itemId, imageType,
//   tag, width, blurHash, onArtworkState and style, and `interface ArtworkStateEvent` with exactly `state: "loaded" | "failed"`.
// - The package is @octave/artwork (private, GPL-3.0-only, main src/index.ts, no dependency of its own), a
//   "workspace:*" dependency of @octave/tv; its Expo config names dev.octave.artwork.OctaveArtworkModule for Android
//   only; its Gradle file has namespace dev.octave.artwork, project(':octave-session'), the JUnit BOM pin of
//   modules/session and the octave.repoRoot property, and names no okhttp, coil, glide, picasso or fresco.
// - In apps/tv/src only apps/tv/src/host/artwork-view.android.tsx names "OctaveArtwork", through requireNativeView;
//   its sibling artwork-view.tsx throws a fixed sentence.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

const MODULE_FILE = "modules/artwork/android/src/main/java/dev/octave/artwork/OctaveArtworkModule.kt";
const PROPS = ["session", "itemId", "imageType", "tag", "width", "blurHash"];
const VIEW = "OctaveArtworkView";
const EVENT = "onArtworkState";

function read(path: string): string {
  expect(existsSync(join(repo, path)), `${path} exists`).toBe(true);
  return readFileSync(join(repo, path), "utf8");
}

const sorted = (values: readonly string[]) => [...values].sort();
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

// Kotlin with comments removed; string and character literals are kept whole.
function kotlinCode(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
      out += " ";
      continue;
    }
    if (c === '"' || c === "'") {
      const end = literalEnd(text, i);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function literalEnd(text: string, start: number): number {
  if (text.startsWith('"""', start)) {
    const end = text.indexOf('"""', start + 3);
    return end < 0 ? text.length : end + 3;
  }
  const quote = text[start];
  let i = start + 1;
  while (i < text.length && text[i] !== quote && text[i] !== "\n") i += text[i] === "\\" ? 2 : 1;
  return Math.min(i + 1, text.length);
}

function closing(code: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < code.length) {
    const c = code[i];
    if (c === '"' || c === "'") {
      i = literalEnd(code, i);
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth += 1;
    if (c === ")" || c === "}" || c === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

interface Call {
  name: string;
  args: string;
  body: string | undefined;
}

// Every call at the top level of a block: an identifier, not after a dot, followed by an argument list, a block, or both.
function topLevelCalls(block: string): Call[] {
  const calls: Call[] = [];
  let i = 0;
  while (i < block.length) {
    const c = block[i];
    if (c === '"' || c === "'") {
      i = literalEnd(block, i);
      continue;
    }
    if (c === "(" || c === "{" || c === "[") {
      const end = closing(block, i);
      i = end < 0 ? block.length : end + 1;
      continue;
    }
    const identifier = /^[A-Za-z_]\w*/.exec(block.slice(i));
    const before = block.slice(0, i).replace(/\s+$/, "");
    if (identifier && !/[\w.]$/.test(block.slice(0, i)) && !before.endsWith(".")) {
      let j = i + identifier[0].length;
      while (/\s/.test(block[j] ?? "")) j += 1;
      let args = "";
      let body: string | undefined;
      let isCall = false;
      if (block[j] === "(") {
        const end = closing(block, j);
        args = block.slice(j + 1, end < 0 ? block.length : end);
        j = end < 0 ? block.length : end + 1;
        isCall = true;
        let k = j;
        while (/[ \t]/.test(block[k] ?? "")) k += 1;
        if (block[k] === "{") j = k;
      }
      if (block[j] === "{") {
        const end = closing(block, j);
        body = block.slice(j + 1, end < 0 ? block.length : end);
        j = end < 0 ? block.length : end + 1;
        isCall = true;
      }
      if (isCall) calls.push({ name: identifier[0], args, body });
      i = Math.max(j, i + identifier[0].length);
      continue;
    }
    i += 1;
  }
  return calls;
}

const stringsIn = (args: string) => [...args.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]);

const FORBIDDEN_ANYWHERE: [string, RegExp][] = [
  ["AsyncFunction", /\bAsyncFunction\b/],
  ["Function", /(?<![\w.])Function\s*\(/],
  ["Property", /\bProperty\s*[({]/],
  ["Constant", /\bConstant\s*[({]/],
  ["Constants", /\bConstants\s*[({]/],
  ["PropGroup", /\bPropGroup\b/],
  ["StaticFunction", /\bStaticFunction\b/],
  ["StaticAsyncFunction", /\bStaticAsyncFunction\b/],
  ["Class", /(?<![\w.])Class\s*[({]/],
  ["GroupView", /\bGroupView\b/],
  ["OnCreate", /\bOnCreate\b/],
  ["sendEvent", /\bsendEvent\s*\(/],
];

interface Surface {
  name: string | undefined;
  views: { name: string; props: string[]; events: string[] }[];
  problems: string[];
}

function surfaceOf(source: string): Surface {
  const code = kotlinCode(source);
  const surface: Surface = { name: undefined, views: [], problems: [] };
  const starts = [...code.matchAll(/\bModuleDefinition\s*\{/g)];
  if (starts.length !== 1) {
    surface.problems.push(`${starts.length} ModuleDefinition blocks`);
    return surface;
  }
  const open = (starts[0].index ?? 0) + starts[0][0].length - 1;
  const definition = code.slice(open + 1, closing(code, open));
  for (const call of topLevelCalls(definition)) {
    switch (call.name) {
      case "Name":
        surface.name = stringsIn(call.args)[0];
        break;
      case "View": {
        const name = /(\w+)\s*::\s*class/.exec(call.args)?.[1];
        if (name === undefined) surface.problems.push("a View without a class");
        const props: string[] = [];
        const events: string[] = [];
        for (const inner of topLevelCalls(call.body ?? "")) {
          if (inner.name === "Prop") props.push(stringsIn(inner.args)[0] ?? "(unnamed)");
          else if (inner.name === "Events") {
            if (stringsIn(inner.args).length === 0) surface.problems.push("an Events call without literal names");
            events.push(...stringsIn(inner.args));
          } else if (!/^On[A-Z]/.test(inner.name)) surface.problems.push(`${inner.name} in the view block`);
        }
        surface.views.push({ name: name ?? "(unnamed)", props, events });
        break;
      }
      case "OnDestroy":
        break;
      default:
        surface.problems.push(`${call.name} in the module definition`);
    }
  }
  const propCount = surface.views.reduce((count, view) => count + view.props.length, 0);
  if ((code.match(/\bProp\s*\(/g) ?? []).length !== propCount) surface.problems.push("a Prop outside a view block");
  const eventCount = surface.views.reduce((count, view) => count + view.events.length, 0);
  const eventCalls = [...code.matchAll(/\bEvents\s*\(([^)]*)\)/g)].reduce((count, match) => count + stringsIn(match[1]).length, 0);
  if (eventCalls !== eventCount) surface.problems.push("an Events call outside a view block");
  for (const [word, pattern] of FORBIDDEN_ANYWHERE) if (pattern.test(code)) surface.problems.push(word);
  return surface;
}

function surfaceProblems(source: string): string[] {
  const surface = surfaceOf(source);
  const problems = [...surface.problems];
  if (surface.name !== "OctaveArtwork") problems.push(`Name(${String(surface.name)}) is not OctaveArtwork`);
  if (surface.views.length !== 1 || surface.views[0].name !== VIEW) problems.push(`views ${JSON.stringify(surface.views.map((view) => view.name))}`);
  const view = surface.views[0];
  if (view !== undefined) {
    if (JSON.stringify(sorted(view.props)) !== JSON.stringify(sorted(PROPS))) problems.push(`props ${JSON.stringify(view.props)}`);
    if (JSON.stringify(view.events) !== JSON.stringify([EVENT])) problems.push(`view events ${JSON.stringify(view.events)}`);
  }
  return problems;
}

function plant(source: string, line: string): string {
  const planted = source.replace(/(Name\s*\(\s*"[^"]*"\s*\))/, `$1\n    ${line}`);
  expect(planted, `the plant of ${line} went in`).not.toBe(source);
  return planted;
}

function plantInView(source: string, line: string): string {
  const match = /View\s*\(\s*\w+\s*::\s*class\s*\)\s*\{/.exec(source);
  expect(match, "the artwork module defines a View(…::class) { … }").not.toBeNull();
  const at = (match?.index ?? 0) + (match?.[0].length ?? 0);
  return `${source.slice(0, at)}\n      ${line}\n${source.slice(at)}`;
}

// The member names of `export interface <name> { … }` in a types file, with the text of each member.
function interfaceMembers(source: string, name: string): Map<string, string> {
  const code = withoutComments(source);
  const start = new RegExp(`\\binterface\\s+${name}\\b[^{]*\\{`).exec(code);
  expect(start, `the types declare interface ${name}`).not.toBeNull();
  const open = (start?.index ?? 0) + (start?.[0].length ?? 1) - 1;
  const body = code.slice(open + 1, closing(code, open));
  const members = new Map<string, string>();
  let depth = 0;
  for (const line of body.split("\n")) {
    const match = /^\s*(?:readonly\s+)?(\w+)\s*[(:?<]/.exec(line);
    if (depth === 0 && match) members.set(match[1], line);
    for (const char of line) {
      if (char === "(" || char === "{" || char === "[") depth += 1;
      if (char === ")" || char === "}" || char === "]") depth -= 1;
    }
  }
  return members;
}

describe("T3-11 item 1: the artwork module's surface", () => {
  it("T3-11 item 1: the Kotlin definition is one view with the six props and one event, and nothing else", () => {
    expect(surfaceProblems(read(MODULE_FILE))).toEqual([]);
  });

  it("T3-11 item 1: a planted URL, header, token or source prop, a function, a module event or a property fails the scan", () => {
    const source = read(MODULE_FILE);
    expect(surfaceProblems(source)).toEqual([]);
    for (const line of [
      'Prop("url") { view: OctaveArtworkView, url: String -> }',
      'Prop("headers") { view: OctaveArtworkView, headers: Map<String, String> -> }',
      'Prop("token") { view: OctaveArtworkView, token: String -> }',
      'Prop("source") { view: OctaveArtworkView, source: String -> }',
      'Prop("blurHash") { view: OctaveArtworkView, hash: String -> }',
      'Events("onLog")',
      'AsyncFunction("reload") { view: OctaveArtworkView -> }',
    ]) {
      expect(surfaceProblems(plantInView(source, line)), `the scan sees ${line} in the view`).not.toEqual([]);
    }
    for (const line of [
      'AsyncFunction("load") { promise: Promise -> promise.resolve(null) }',
      'Function("token") { "" }',
      'Events("onArtworkState")',
      'Events("artworkLoaded")',
      'Property("header") { "" }',
      'Constants("url" to "")',
      'Constant("token") { "" }',
      'Class("Loader") { }',
      'StaticFunction("make") { }',
      "OnCreate { }",
      'Prop("url") { view: OctaveArtworkView, url: String -> }',
      "View(SecondView::class) { }",
      "registerMore(this)",
    ]) {
      expect(surfaceProblems(plant(source, line)), `the scan sees ${line}`).not.toEqual([]);
    }
    expect(surfaceProblems(`${source}\nfun stray() { sendEvent("onArtworkState", mapOf<String, Any>()) }`), "a sendEvent").not.toEqual([]);
  });

  it("T3-11 item 1: the allowlist file is the one view, its six props and its one event", () => {
    const allowlist = JSON.parse(read("modules/artwork/surface-allowlist.json")) as unknown;
    expect(allowlist).toEqual({
      module: "OctaveArtwork",
      functions: [],
      events: [],
      views: [{ name: VIEW, props: PROPS, events: [EVENT] }],
      pending: {},
    });
  });

  it("T3-11 item 1: docs/security.md has one artwork allowlist line naming the view, its six props and its event", () => {
    const lines = read("docs/security.md").split("\n");
    const found = lines.filter((line) => /^\s*(?:[-*]\s+)?Artwork\s+module\s+allowlist:/.test(line));
    expect(found.length, 'docs/security.md has exactly one line starting "Artwork module allowlist:"').toBe(1);
    const names = [...found[0].matchAll(/`([^`]+)`/g)].map((match) => match[1]).filter((name) => name !== "OctaveArtwork" && !/^T\d+-\d{2}$/.test(name));
    expect(sorted(names)).toEqual(sorted([VIEW, ...PROPS, EVENT]));
  });

  it("T3-11 item 1: the TypeScript types declare the six props, the event handler and style, and the event's two states", () => {
    const types = read("modules/artwork/src/index.ts");
    const props = interfaceMembers(types, "OctaveArtworkViewProps");
    expect(sorted([...props.keys()])).toEqual(sorted([...PROPS, EVENT, "style"]));
    expect(props.get("session")).toMatch(/:\s*string\b/);
    expect(props.get("itemId")).toMatch(/:\s*string\b/);
    expect(props.get("tag")).toMatch(/:\s*string\b/);
    expect(props.get("width")).toMatch(/:\s*number\b/);
    const event = interfaceMembers(types, "ArtworkStateEvent");
    expect([...event.keys()]).toEqual(["state"]);
    const state = event.get("state") ?? "";
    expect(state).toMatch(/"loaded"/);
    expect(state).toMatch(/"failed"/);
    expect(state.replace(/"loaded"|"failed"/g, "")).not.toMatch(/"/);
    expect(withoutComments(types), "types only: no runtime export").not.toMatch(/\bexport\s+(?:const|let|var|function|class|default)\b/);
  });
});

describe("T3-11 item 1: the artwork module package", () => {
  it("T3-11 item 1: modules/artwork is the workspace package @octave/artwork, a dependency of the TV app", () => {
    const pkg = JSON.parse(read("modules/artwork/package.json")) as Record<string, unknown>;
    expect(pkg.name).toBe("@octave/artwork");
    expect(pkg.private).toBe(true);
    expect(pkg.license).toBe("GPL-3.0-only");
    expect(pkg.main).toBe("src/index.ts");
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      expect(pkg[field] ?? {}, `the package declares no ${field}`).toEqual({});
    }
    const app = JSON.parse(read("apps/tv/package.json")) as { dependencies: Record<string, string> };
    expect(app.dependencies["@octave/artwork"]).toBe("workspace:*");
  });

  it("T3-11 item 1: the Expo config names the module class for Android only, and the class exists", () => {
    const config = JSON.parse(read("modules/artwork/expo-module.config.json")) as { platforms: string[]; android: { modules: string[] } };
    expect(config.platforms).toEqual(["android"]);
    expect(config.android.modules).toEqual(["dev.octave.artwork.OctaveArtworkModule"]);
    expect(withoutComments(read(MODULE_FILE))).toMatch(/\bclass\s+OctaveArtworkModule\s*:\s*Module\s*\(\s*\)/);
  });

  it("T3-11 item 1: the Gradle file has the namespace, the session project and the JUnit BOM pin, and no HTTP or image library", () => {
    const gradle = read("modules/artwork/android/build.gradle");
    const code = withoutComments(gradle);
    expect(code).toMatch(/namespace\s*=?\s*["']dev\.octave\.artwork["']/);
    expect(code).toMatch(/project\s*\(\s*["']:octave-session["']\s*\)/);
    const sessionBom = /org\.junit:junit-bom:[\d.]+/.exec(read("modules/session/android/build.gradle"))?.[0];
    expect(sessionBom, "modules/session pins a JUnit BOM").toBeDefined();
    expect(code, "the same JUnit BOM pin as modules/session").toContain(sessionBom ?? "junit-bom");
    expect(code).toMatch(/systemProperty\s*\(?\s*["']octave\.repoRoot["']/);
    for (const word of [/okhttp/i, /coil/i, /glide/i, /picasso/i, /fresco/i]) expect(gradle, `build.gradle names ${word}`).not.toMatch(word);
  });

  it("T3-11 item 1: the view loader is the only app file that names the native module, and its sibling throws", () => {
    const sources = filesUnder("apps/tv/src", /\.(ts|tsx)$/).map((path) => ({ path, code: withoutComments(readFileSync(join(repo, path), "utf8")) }));
    const naming = sources.filter(({ code }) => /["'`]OctaveArtwork["'`]/.test(code)).map(({ path }) => path);
    expect(naming).toEqual(["apps/tv/src/host/artwork-view.android.tsx"]);
    expect(withoutComments(read("apps/tv/src/host/artwork-view.android.tsx"))).toMatch(/\brequireNativeView\w*\b[^;(]*\(\s*["']OctaveArtwork["']/);
    expect(read("apps/tv/src/host/artwork-view.tsx"), "the tvOS sibling throws a fixed sentence").toMatch(/throw new Error\(\s*"[^"]+"\s*\)/);
  });
});
