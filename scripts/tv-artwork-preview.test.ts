// @vitest-environment node
// T3-39 acceptance item 1, the surface half (docs/specs/T3-39.md, "Files to touch" and decision 0005's T3-39
// amendment): the artwork view gains one prop, blurHash, which carries the hash string only. Source scans only: nothing
// here loads the module. apps/tv/src/host/native-artwork-preview.test.tsx holds which view instance receives it.
//
// The contract frozen here:
// - modules/artwork/android/src/main/java/dev/octave/artwork/OctaveArtworkModule.kt declares, inside the block of its one
//   `View(OctaveArtworkView::class) { … }`, exactly one `Prop("blurHash") { view: OctaveArtworkView, value: String? -> … }`
//   (any parameter names, the value typed `String?`), and no Prop("blurHash") elsewhere. The view block's Props are
//   exactly session, itemId, imageType, tag, drawnWidth and blurHash, so a planted or renamed `Prop("blurHashUrl")` or
//   `Prop("previewUrl")` fails the scan.
// - modules/artwork/surface-allowlist.json's one view lists the props ["session", "itemId", "imageType", "tag", "drawnWidth",
//   "blurHash"] in that order, and its events stay ["onArtworkState"].
// - modules/artwork/src/index.ts's `interface OctaveArtworkViewProps` has the member `blurHash?: string` (readonly
//   allowed) and no url, uri, source, src, headers, header or token member.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODULE_FILE = "modules/artwork/android/src/main/java/dev/octave/artwork/OctaveArtworkModule.kt";
const SIX = ["session", "itemId", "imageType", "tag", "drawnWidth", "blurHash"];
const FORBIDDEN_MEMBERS = ["url", "uri", "source", "src", "headers", "header", "token"];

function read(path: string): string {
  expect(existsSync(join(repo, path)), `${path} exists`).toBe(true);
  return readFileSync(join(repo, path), "utf8");
}

// Kotlin or TypeScript with comments removed; string literals are kept whole.
function code(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("//", i)) {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
      out += " ";
      continue;
    }
    if (text[i] === '"') {
      const end = stringEnd(text, i);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
}

function stringEnd(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length && text[i] !== '"' && text[i] !== "\n") i += text[i] === "\\" ? 2 : 1;
  return Math.min(i + 1, text.length);
}

// The index just past the bracket that closes the one at `open`, skipping string literals.
function closeOf(text: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    if (text[i] === '"') {
      i = stringEnd(text, i);
      continue;
    }
    if ("({[".includes(text[i])) depth += 1;
    if (")}]".includes(text[i])) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return -1;
}

interface ViewScan {
  props: string[];
  blurHashDeclarations: string[];
  problems: string[];
}

function scanView(source: string): ViewScan {
  const text = code(source);
  const scan: ViewScan = { props: [], blurHashDeclarations: [], problems: [] };
  const views = [...text.matchAll(/\bView\s*\(\s*OctaveArtworkView\s*::\s*class\s*\)\s*\{/g)];
  if (views.length !== 1) {
    scan.problems.push(`${views.length} View(OctaveArtworkView::class) blocks`);
    return scan;
  }
  const open = (views[0].index ?? 0) + views[0][0].length - 1;
  const close = closeOf(text, open);
  const block = text.slice(open + 1, close - 1);
  const outside = text.slice(0, open) + text.slice(close);
  scan.props = [...block.matchAll(/\bProp\s*\(\s*"([^"]*)"/g)].map((match) => match[1]);
  scan.blurHashDeclarations = [...block.matchAll(/\bProp\s*\(\s*"blurHash"\s*\)\s*\{([^}]*?)->/g)].map((match) => match[1].trim());
  if (/\bProp\s*\(/.test(outside)) scan.problems.push("a Prop outside the view block");
  if ([...block.matchAll(/\bProp\s*\(/g)].length !== scan.props.length) scan.problems.push("a Prop without a literal name");
  if (JSON.stringify([...scan.props].sort()) !== JSON.stringify([...SIX].sort())) scan.problems.push(`props ${JSON.stringify(scan.props)}`);
  if (scan.blurHashDeclarations.length !== 1) scan.problems.push(`${scan.blurHashDeclarations.length} Prop("blurHash") declarations`);
  else if (!/^\w+\s*:\s*OctaveArtworkView\s*,\s*\w+\s*:\s*String\?$/.test(scan.blurHashDeclarations[0])) {
    scan.problems.push(`Prop("blurHash") takes (${scan.blurHashDeclarations[0]}), not (view: OctaveArtworkView, value: String?)`);
  }
  return scan;
}

function plantInView(source: string, line: string): string {
  const match = /View\s*\(\s*OctaveArtworkView\s*::\s*class\s*\)\s*\{/.exec(source);
  expect(match, "the module defines View(OctaveArtworkView::class) { … }").not.toBeNull();
  const at = (match?.index ?? 0) + (match?.[0].length ?? 0);
  return `${source.slice(0, at)}\n      ${line}\n${source.slice(at)}`;
}

function interfaceMembers(source: string, name: string): Map<string, string> {
  const text = code(source);
  const start = new RegExp(`\\binterface\\s+${name}\\b[^{]*\\{`).exec(text);
  expect(start, `the types declare interface ${name}`).not.toBeNull();
  const open = (start?.index ?? 0) + (start?.[0].length ?? 1) - 1;
  const body = text.slice(open + 1, closeOf(text, open) - 1);
  const members = new Map<string, string>();
  let depth = 0;
  for (const line of body.split("\n")) {
    const match = /^\s*(?:readonly\s+)?(\w+)\s*[(:?<]/.exec(line);
    if (depth === 0 && match) members.set(match[1], line.trim());
    for (const char of line) {
      if ("({[".includes(char)) depth += 1;
      if (")}]".includes(char)) depth -= 1;
    }
  }
  return members;
}

describe("T3-39 item 1: the artwork view's sixth prop holds the hash string only", () => {
  it("T3-39 item 1: the Kotlin view block declares Prop(\"blurHash\") with a String? value, beside the five T3-11 props", () => {
    const scan = scanView(read(MODULE_FILE));
    expect(scan.problems).toEqual([]);
    expect(scan.props).toContain("blurHash");
  });

  it("T3-39 item 1: a planted or renamed blurHashUrl or previewUrl prop fails the same scan", () => {
    const source = read(MODULE_FILE);
    expect(scanView(source).problems).toEqual([]);
    for (const line of ['Prop("blurHashUrl") { view: OctaveArtworkView, value: String? -> }', 'Prop("previewUrl") { view: OctaveArtworkView, value: String? -> }']) {
      expect(scanView(plantInView(source, line)).problems, `the scan sees ${line}`).not.toEqual([]);
    }
    for (const name of ["blurHashUrl", "previewUrl"]) {
      const renamed = source.replace(/Prop\s*\(\s*"blurHash"\s*\)/, `Prop("${name}")`);
      expect(renamed, `the rename to ${name} went in`).not.toBe(source);
      expect(scanView(renamed).problems, `the scan sees blurHash renamed to ${name}`).not.toEqual([]);
    }
    const retyped = source.replace(/(Prop\s*\(\s*"blurHash"\s*\)\s*\{[^}]*?:\s*)String\?(\s*->)/, "$1Map<String, String>?$2");
    expect(retyped, "the retype went in").not.toBe(source);
    expect(scanView(retyped).problems, "the scan sees a blurHash that is not a String?").not.toEqual([]);
  });

  it("T3-39 item 1: the allowlist file lists the six props in order and the one event", () => {
    const allowlist = JSON.parse(read("modules/artwork/surface-allowlist.json")) as unknown;
    expect(allowlist).toEqual({
      module: "OctaveArtwork",
      functions: [],
      events: [],
      views: [{ name: "OctaveArtworkView", props: SIX, events: ["onArtworkState"] }],
      pending: {},
    });
  });

  it("T3-39 item 1: OctaveArtworkViewProps has blurHash?: string and no URL, header or token member", () => {
    const members = interfaceMembers(read("modules/artwork/src/index.ts"), "OctaveArtworkViewProps");
    expect(members.get("blurHash")).toMatch(/^(?:readonly\s+)?blurHash\s*\?\s*:\s*string\s*;?$/);
    for (const name of FORBIDDEN_MEMBERS) expect(members.has(name), `OctaveArtworkViewProps has ${name}`).toBe(false);
  });
});
