// @vitest-environment node
// T8-01 acceptance item 1 (docs/specs/T8-01.md, "The allowlists"): each native module's JavaScript surface is held by
// three things that must agree, its Kotlin definition, its own `surface-allowlist.json`, and its one line in
// docs/security.md, so a method or event added to either module without the other two fails here.
//
// The contract frozen here:
// - The player module (modules/player): OctavePlayerModule.kt defines `Name("OctavePlayer")`, the six AsyncFunctions
//   initialize, launch, setPaused, seek, selectTrack and stop, `Events("playerEvent")` and one view,
//   OctavePlayerView, with no prop. Its functions plus `subscribe` (Expo's emitter over `playerEvent`, T2-05 D2) are
//   the port's PLAYER_ENGINE_METHODS, and its `eventKinds` are PLAYER_EVENT_KINDS, both imported from the core.
// - The session module (modules/session): decision 0005's five names, signIn, request, restoreSessions, endSession
//   and the event sessionEnded. `pending` may name restoreSessions and sessionEnded only, each with the task that
//   builds it (Product Owner ruling of 2026-11-22, tasks/product-owner-log.md); what Kotlin defines equals the
//   allowlist minus `pending`, so a pending member that is defined fails, and T4-05 removes its entries.
// - The scan reads the definition block the other way round (spec check issue 1): every call at the top level of
//   `ModuleDefinition { }` must be `Name`, `AsyncFunction`, `Events`, `View` or `OnDestroy`, and a view's block may
//   hold only `Prop` (which the allowlist must list) and `On…` lifecycle hooks. Anywhere in the file's code,
//   `Function`, `Property`, `Constant`, `Constants`, `Prop` outside a listed view prop, `PropGroup`, `StaticFunction`,
//   `StaticAsyncFunction`, `Class`, `GroupView` and `OnCreate` fail, and so does `sendEvent` with a name outside the
//   module's defined events, in any main Kotlin file of the module.
// - docs/security.md has exactly one line starting `Player module allowlist:` and one starting `Session module
//   allowlist:` (a list marker before it is allowed). The backticked names on each are exactly that module's
//   functions, events and view names, and the line names the task of every pending member.
// - The types in modules/<name>/src/index.ts (OctavePlayerNative, OctaveSessionNative) declare no function the
//   allowlist lacks; `addListener` is allowed when the module has an event. The player's declares the six and
//   `addListener`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLAYER_ENGINE_METHODS, PLAYER_EVENT_KINDS } from "../packages/core/src/domain/player-engine";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

interface View {
  name: string;
  props: string[];
}

interface Allowlist {
  module: string;
  functions: string[];
  events: string[];
  eventKinds?: string[];
  views: View[];
  pending: Record<string, string>;
}

interface ModuleCase {
  dir: string;
  moduleFile: string;
  packageDir: string;
  nativeType: string;
  docPrefix: string;
}

const PLAYER: ModuleCase = {
  dir: "modules/player",
  moduleFile: "modules/player/android/src/main/java/dev/octave/player/OctavePlayerModule.kt",
  packageDir: "modules/player/android/src/main/java/dev/octave/player",
  nativeType: "OctavePlayerNative",
  docPrefix: "Player module allowlist:",
};

const SESSION: ModuleCase = {
  dir: "modules/session",
  moduleFile: "modules/session/android/src/main/java/dev/octave/session/OctaveSessionModule.kt",
  packageDir: "modules/session/android/src/main/java/dev/octave/session",
  nativeType: "OctaveSessionNative",
  docPrefix: "Session module allowlist:",
};

// Decision 0005 (docs/decisions/0005-token-boundary.md): the session module's allowlist, written here.
const DECISION_0005_FUNCTIONS = ["signIn", "request", "restoreSessions", "endSession"];
const DECISION_0005_EVENTS = ["sessionEnded"];
const SESSION_MAY_PEND = ["restoreSessions", "sessionEnded"];

const PLAYER_FUNCTIONS = ["initialize", "launch", "setPaused", "seek", "selectTrack", "stop"];

const read = (path: string) => readFileSync(join(repo, path), "utf8");
const sorted = (values: readonly string[]) => [...values].sort();

function allowlistOf(module: ModuleCase): Allowlist {
  const path = `${module.dir}/surface-allowlist.json`;
  expect(existsSync(join(repo, path)), `${path} exists`).toBe(true);
  return JSON.parse(read(path)) as Allowlist;
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

// The index just past the string or character literal that starts at `start`.
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

// The index of the bracket that closes the one at `open`, skipping literals.
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

// Every call at the top level of a block: an identifier, not after a dot, followed by an argument list, a trailing
// block, or both.
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
];

interface Surface {
  name: string | undefined;
  functions: string[];
  events: string[];
  views: View[];
  problems: string[];
}

// What a module's Kotlin definition declares, and every shape the allowlist cannot hold.
function surfaceOf(source: string): Surface {
  const code = kotlinCode(source);
  const surface: Surface = { name: undefined, functions: [], events: [], views: [], problems: [] };
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
      case "AsyncFunction": {
        const name = stringsIn(call.args)[0];
        if (name === undefined) surface.problems.push("an AsyncFunction without a literal name");
        else surface.functions.push(name);
        break;
      }
      case "Events":
        surface.events.push(...stringsIn(call.args));
        if (stringsIn(call.args).length === 0) surface.problems.push("an Events call without literal names");
        break;
      case "View": {
        const name = /(\w+)\s*::\s*class/.exec(call.args)?.[1];
        if (name === undefined) surface.problems.push("a View without a class");
        const props: string[] = [];
        for (const inner of topLevelCalls(call.body ?? "")) {
          if (inner.name === "Prop") props.push(stringsIn(inner.args)[0] ?? "(unnamed)");
          else if (!/^On[A-Z]/.test(inner.name)) surface.problems.push(`${inner.name} in the view block`);
        }
        surface.views.push({ name: name ?? "(unnamed)", props });
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
  for (const [word, pattern] of FORBIDDEN_ANYWHERE) if (pattern.test(code)) surface.problems.push(word);
  return surface;
}

// Every sendEvent in the module's main Kotlin must name a defined event with a literal.
function sendEventProblems(module: ModuleCase, events: readonly string[], extra?: string): string[] {
  const problems: string[] = [];
  const files = kotlinFiles(join(repo, module.packageDir)).map((path) => readFileSync(path, "utf8"));
  if (extra !== undefined) files.push(extra);
  for (const text of files) {
    for (const match of kotlinCode(text).matchAll(/\bsendEvent\s*\(\s*([^,)]*)/g)) {
      const literal = /^"([^"]*)"$/.exec(match[1].trim());
      if (!literal) problems.push(`sendEvent(${match[1].trim()}) without a literal name`);
      else if (!events.includes(literal[1])) problems.push(`sendEvent("${literal[1]}") outside the defined events`);
    }
  }
  return problems;
}

function kotlinFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return kotlinFiles(path);
    return /\.(kt|java)$/.test(name) ? [path] : [];
  });
}

// The problems of one module: its definition, its allowlist and its pending map, compared.
function moduleProblems(module: ModuleCase, allowlist: Allowlist, source: string, plantedSendEvent?: string): string[] {
  const surface = surfaceOf(source);
  const problems = [...surface.problems];
  const pending = Object.keys(allowlist.pending ?? {});
  for (const name of pending) {
    if (!allowlist.functions.includes(name) && !allowlist.events.includes(name)) problems.push(`pending names ${name}, which the list does not`);
    if (surface.functions.includes(name) || surface.events.includes(name)) problems.push(`${name} is defined but still pending`);
  }
  const expectedFunctions = allowlist.functions.filter((name) => !pending.includes(name));
  const expectedEvents = allowlist.events.filter((name) => !pending.includes(name));
  if (surface.name !== allowlist.module) problems.push(`Name(${String(surface.name)}) is not ${allowlist.module}`);
  if (surface.functions.length !== new Set(surface.functions).size) problems.push("a function is defined twice");
  if (JSON.stringify(sorted(surface.functions)) !== JSON.stringify(sorted(expectedFunctions))) {
    problems.push(`functions ${JSON.stringify(sorted(surface.functions))}, allowed ${JSON.stringify(sorted(expectedFunctions))}`);
  }
  if (JSON.stringify(sorted(surface.events)) !== JSON.stringify(sorted(expectedEvents))) {
    problems.push(`events ${JSON.stringify(sorted(surface.events))}, allowed ${JSON.stringify(sorted(expectedEvents))}`);
  }
  const viewKey = (views: readonly View[]) => JSON.stringify(views.map((view) => [view.name, sorted(view.props)]).sort());
  if (viewKey(surface.views) !== viewKey(allowlist.views)) problems.push(`views ${viewKey(surface.views)}, allowed ${viewKey(allowlist.views)}`);
  problems.push(...sendEventProblems(module, surface.events, plantedSendEvent));
  return problems;
}

// The backticked names on the module's one line in docs/security.md.
function docLine(module: ModuleCase): string {
  const lines = read("docs/security.md").split("\n");
  const prefix = new RegExp(`^\\s*(?:[-*]\\s+)?${module.docPrefix.replace(/ /g, "\\s+")}`);
  const found = lines.filter((line) => prefix.test(line));
  expect(found.length, `docs/security.md has exactly one line starting "${module.docPrefix}"`).toBe(1);
  return found[0];
}

const backticked = (line: string) => [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1]);

// The member names of `export interface <name> { … }` in a types file.
function interfaceMembers(source: string, name: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const start = new RegExp(`\\binterface\\s+${name}\\b[^{]*\\{`).exec(code);
  expect(start, `the types declare interface ${name}`).not.toBeNull();
  const open = (start?.index ?? 0) + (start?.[0].length ?? 1) - 1;
  const body = code.slice(open + 1, closing(code, open));
  const names: string[] = [];
  let depth = 0;
  for (const line of body.split("\n")) {
    const match = /^\s*(?:readonly\s+)?(\w+)\s*[(:?<]/.exec(line);
    if (depth === 0 && match) names.push(match[1]);
    for (const char of line) {
      if (char === "(" || char === "{" || char === "[") depth += 1;
      if (char === ")" || char === "}" || char === "]") depth -= 1;
    }
  }
  return names;
}

// Plants a line right after the module's Name(...) call, where every member of the definition goes.
function plant(source: string, line: string): string {
  const planted = source.replace(/(Name\s*\(\s*"[^"]*"\s*\))/, `$1\n    ${line}`);
  expect(planted, `the plant of ${line} went in`).not.toBe(source);
  return planted;
}

function plantInView(source: string, line: string): string {
  const match = /View\s*\(\s*\w+\s*::\s*class\s*\)\s*\{/.exec(source);
  if (match) return source.slice(0, match.index + match[0].length) + `\n      ${line}\n` + source.slice(match.index + match[0].length);
  const bare = /View\s*\(\s*\w+\s*::\s*class\s*\)/.exec(source);
  expect(bare, "the player module defines a View(…::class)").not.toBeNull();
  const end = (bare?.index ?? 0) + (bare?.[0].length ?? 0);
  return `${source.slice(0, end)} {\n      ${line}\n    }${source.slice(end)}`;
}

describe("the player module's surface", () => {
  it("T8-01 item 1: the allowlist file lists the port's six functions, one event, the six kinds and one view with no prop", () => {
    const allowlist = allowlistOf(PLAYER);
    expect(sorted(Object.keys(allowlist))).toEqual(sorted(["module", "functions", "events", "eventKinds", "views", "pending"]));
    expect(allowlist.module).toBe("OctavePlayer");
    expect(sorted(allowlist.functions)).toEqual(sorted(PLAYER_FUNCTIONS));
    expect(sorted([...allowlist.functions, "subscribe"]), "functions plus subscribe are the port's PLAYER_ENGINE_METHODS").toEqual(sorted(PLAYER_ENGINE_METHODS));
    expect(allowlist.events).toEqual(["playerEvent"]);
    expect(sorted(allowlist.eventKinds ?? []), "eventKinds are the port's PLAYER_EVENT_KINDS").toEqual(sorted(PLAYER_EVENT_KINDS));
    expect(allowlist.views).toEqual([{ name: "OctavePlayerView", props: [] }]);
    expect(allowlist.pending, "nothing of the player module is pending").toEqual({});
  });

  it("T8-01 item 1: the Kotlin definition, the allowlist and docs/security.md agree", () => {
    const allowlist = allowlistOf(PLAYER);
    expect(existsSync(join(repo, PLAYER.moduleFile)), `${PLAYER.moduleFile} exists`).toBe(true);
    expect(moduleProblems(PLAYER, allowlist, read(PLAYER.moduleFile))).toEqual([]);
    const surface = surfaceOf(read(PLAYER.moduleFile));
    expect(sorted(surface.functions)).toEqual(sorted(PLAYER_FUNCTIONS));
    expect(surface.events).toEqual(["playerEvent"]);
    expect(sorted(backticked(docLine(PLAYER))), "the doc line's backticked names").toEqual(
      sorted([...allowlist.functions, ...allowlist.events, ...allowlist.views.map((view) => view.name)]),
    );
  });

  it("T8-01 item 1: the types declare the six functions and addListener, nothing else", () => {
    const path = "modules/player/src/index.ts";
    expect(existsSync(join(repo, path)), `${path} exists`).toBe(true);
    const members = interfaceMembers(read(path), PLAYER.nativeType);
    expect(members.length, "no member is declared twice").toBe(new Set(members).size);
    expect(sorted(members)).toEqual(sorted([...PLAYER_FUNCTIONS, "addListener"]));
  });

  it("T8-01 item 1: a planted function, event, property, constant, class, view prop or stray sendEvent fails the scan", () => {
    const allowlist = allowlistOf(PLAYER);
    const source = read(PLAYER.moduleFile);
    expect(moduleProblems(PLAYER, allowlist, source)).toEqual([]);
    const plants = [
      'AsyncFunction("setVolume") { promise: Promise -> promise.resolve(null) }',
      'Function("launchSync") { 0 }',
      'Events("playerEvent", "progress")',
      'Events("log")',
      'Property("url") { "" }',
      'Constants("headers" to "")',
      'Constant("token") { "" }',
      'Class("Player") { }',
      'StaticFunction("make") { }',
      'StaticAsyncFunction("make") { }',
      "OnCreate { }",
      "OnStartObserving { }",
      "registerMore(this)",
    ];
    for (const line of plants) {
      expect(moduleProblems(PLAYER, allowlist, plant(source, line)), `the scan sees ${line}`).not.toEqual([]);
    }
    for (const line of ['Prop("url") { view: OctavePlayerView, url: String -> }', 'PropGroup("source", "uri") { view: OctavePlayerView, value: String -> }', 'Events("onLoad")', 'AsyncFunction("load") { view: OctavePlayerView -> }']) {
      expect(moduleProblems(PLAYER, allowlist, plantInView(source, line)), `the scan sees ${line} in the view`).not.toEqual([]);
    }
    expect(moduleProblems(PLAYER, allowlist, source, 'fun stray() { sendEvent("progress", mapOf()) }'), "a sendEvent outside the events").not.toEqual([]);
  });
});

describe("the session module's surface", () => {
  it("T8-01 item 1: the scan reads the session definition as it stands, so it cannot pass empty", () => {
    const surface = surfaceOf(read(SESSION.moduleFile));
    expect(surface.problems).toEqual([]);
    expect(surface.name).toBe("OctaveSession");
    for (const name of ["signIn", "request", "endSession"]) expect(surface.functions).toContain(name);
    expect(surface.views).toEqual([]);
    expect(surfaceOf(plant(read(SESSION.moduleFile), 'Property("header") { "" }')).problems).not.toEqual([]);
  });

  it("T8-01 item 1: the allowlist file is decision 0005's five names, and only restoreSessions and sessionEnded may pend", () => {
    const allowlist = allowlistOf(SESSION);
    expect(sorted(Object.keys(allowlist))).toEqual(sorted(["module", "functions", "events", "views", "pending"]));
    expect(allowlist.module).toBe("OctaveSession");
    expect(sorted(allowlist.functions)).toEqual(sorted(DECISION_0005_FUNCTIONS));
    expect(allowlist.events).toEqual(DECISION_0005_EVENTS);
    expect(allowlist.views).toEqual([]);
    for (const [name, task] of Object.entries(allowlist.pending)) {
      expect(SESSION_MAY_PEND, `${name} may pend`).toContain(name);
      expect(task, `pending ${name} names the task that builds it`).toMatch(/^T\d+-\d{2}$/);
    }
  });

  it("T8-01 item 1: the Kotlin definition, the allowlist and docs/security.md agree", () => {
    const allowlist = allowlistOf(SESSION);
    expect(moduleProblems(SESSION, allowlist, read(SESSION.moduleFile))).toEqual([]);
    const line = docLine(SESSION);
    expect(sorted(backticked(line).filter((name) => !/^T\d+-\d{2}$/.test(name))), "the doc line's backticked names").toEqual(
      sorted([...allowlist.functions, ...allowlist.events]),
    );
    for (const task of new Set(Object.values(allowlist.pending))) expect(line, `the doc line names ${task} for its pending members`).toContain(task);
  });

  it("T8-01 item 1: the types declare no function the allowlist lacks", () => {
    const allowlist = allowlistOf(SESSION);
    const allowed = [...allowlist.functions, ...(allowlist.events.length > 0 ? ["addListener"] : [])];
    for (const member of interfaceMembers(read("modules/session/src/index.ts"), SESSION.nativeType)) {
      expect(allowed, `${SESSION.nativeType}.${member} is on the allowlist`).toContain(member);
    }
  });

  it("T8-01 item 1: a pending member that is defined, an unlisted member, or a pending name off the list fails", () => {
    const allowlist = allowlistOf(SESSION);
    const source = read(SESSION.moduleFile);
    expect(moduleProblems(SESSION, allowlist, source)).toEqual([]);
    // Before T4-05 the two are planted; once T4-05 defines them, the real source is checked with them pending.
    const defined = surfaceOf(source);
    const members: [string, string][] = [
      ["restoreSessions", 'AsyncFunction("restoreSessions") { promise: Promise -> promise.resolve(null) }'],
      ["sessionEnded", 'Events("sessionEnded")'],
    ];
    for (const [name, line] of members) {
      const withMember = defined.functions.includes(name) || defined.events.includes(name) ? source : plant(source, line);
      const stillPending = { ...allowlist, pending: { ...allowlist.pending, [name]: "T4-05" } };
      expect(moduleProblems(SESSION, stillPending, withMember), `${name} defined while pending`).not.toEqual([]);
    }
    for (const line of ['AsyncFunction("token") { promise: Promise -> promise.resolve(null) }', 'Function("header") { "" }', 'Events("tokenChanged")', 'Property("header") { "" }', 'Constant("token") { "" }', 'View(SessionView::class) { }']) {
      expect(moduleProblems(SESSION, allowlist, plant(source, line)), `the scan sees ${line}`).not.toEqual([]);
    }
    expect(moduleProblems(SESSION, { ...allowlist, pending: { ...allowlist.pending, refreshToken: "T4-05" } }, source), "a pending name the list does not hold").not.toEqual([]);
  });
});
