// T8-03 item 1 (D14): outside the e2e app, no file under apps/tv/src imports a media URL builder or holds a media path.
// Only Playback Negotiation builds media URLs. Comments and module specifiers are blanked before the path patterns run, so
// `@octave/core/src/streaming-limits` is never read as a `/stream` path.
import { describe, expect, it } from "@jest/globals";

// apps/tv has no Node type definitions, so what the scan calls is typed here.
declare const __dirname: string;
const { readdirSync, readFileSync } = require("fs") as {
  readdirSync(dir: string, options: { withFileTypes: true }): { name: string; isFile(): boolean; isDirectory(): boolean }[];
  readFileSync(path: string, encoding: "utf8"): string;
};
const { join, relative } = require("path") as { join(...parts: string[]): string; relative(from: string, to: string): string };

type Node = { type: string; start: number; end: number; [key: string]: unknown };
const { parseSync } = require("@babel/core") as {
  parseSync(code: string, options: object): { program: Node; comments?: Node[] | null };
};

const SOURCE_ROOT = join(__dirname, "..");
const SKIPPED_DIRECTORIES = ["e2e", "test-support"];

const FORBIDDEN_MODULES = ["jellyfin/hls-url", "player/launch-request", "jellyfin/device-profile"];
const FORBIDDEN_TEXT: RegExp[] = [/\bbuildStaticStreamUrl\b/, /\/Videos\//, /master\.m3u8/, /Static=true/, /\/stream(?![\w-])/];

const isNode = (value: unknown): value is Node => typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
const isString = (value: unknown): value is Node & { value: string } => isNode(value) && value.type === "StringLiteral";

function firstArgument(node: Node): unknown {
  return Array.isArray(node.arguments) ? node.arguments[0] : undefined;
}

/** The module specifier a node names, when it imports or re-exports one. */
function specifierOf(node: Node): unknown {
  switch (node.type) {
    case "ImportDeclaration":
    case "ExportNamedDeclaration":
    case "ExportAllDeclaration":
    case "ImportExpression":
      return node.source;
    case "TSImportType":
      return node.argument;
    case "TSExternalModuleReference":
      return node.expression;
    case "CallExpression": {
      const callee = node.callee as Node & { name?: string };
      return callee.type === "Import" || callee.name === "require" ? firstArgument(node) : undefined;
    }
    default:
      return undefined;
  }
}

function specifierNodes(node: unknown, found: (Node & { value: string })[] = []): (Node & { value: string })[] {
  if (Array.isArray(node)) {
    for (const child of node) specifierNodes(child, found);
    return found;
  }
  if (!isNode(node)) return found;
  const specifier = specifierOf(node);
  if (isString(specifier)) found.push(specifier);
  for (const child of Object.values(node)) specifierNodes(child, found);
  return found;
}

/** Every way `text` reaches for a media URL builder or holds a media path. */
function violationsOf(fileName: string, text: string): string[] {
  const plugins = fileName.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"];
  const ast = parseSync(text, { babelrc: false, configFile: false, filename: fileName, parserOpts: { plugins } });
  const specifiers = specifierNodes(ast.program);
  const imports = specifiers
    .filter(({ value }) => FORBIDDEN_MODULES.some((module) => value.endsWith(module)))
    .map(({ value }) => `${fileName} imports ${value}`);
  let rest = text;
  for (const { start, end } of [...specifiers, ...(ast.comments ?? [])]) {
    rest = rest.slice(0, start) + " ".repeat(end - start) + rest.slice(end);
  }
  const literals = FORBIDDEN_TEXT.filter((pattern) => pattern.test(rest)).map((pattern) => `${fileName} holds ${pattern.source}`);
  return [...imports, ...literals];
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRECTORIES.includes(entry.name) ? [] : sourceFiles(path);
    const isSource = /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name);
    return entry.isFile() && isSource ? [path] : [];
  });
}

describe("T8-03 item 1: no app code builds a media URL", () => {
  it("T8-03 item 1: no file under apps/tv/src outside the e2e app imports a URL builder or holds a media path", () => {
    const files = sourceFiles(SOURCE_ROOT);
    const names = files.map((file) => relative(SOURCE_ROOT, file));
    expect(names).toEqual(expect.arrayContaining(["App.tsx", "host/gateway.ts", "host/preferences.ts", "home/home-screen.tsx"]));
    expect(files.flatMap((file) => violationsOf(relative(SOURCE_ROOT, file), readFileSync(file, "utf8")))).toEqual([]);
  });

  it("T8-03 item 1: the scan lets an import of the streaming limits through", () => {
    expect(violationsOf("sample.ts", 'import { limits } from "@octave/core/src/streaming-limits";\nexport const used = limits;')).toEqual([]);
  });

  it("T8-03 item 1: the scan lets a media path in a comment through", () => {
    const text = '// the server answers under "/Videos/"\n/* and "/Videos/x/stream?static=true" */\nexport const none = 1;';
    expect(violationsOf("sample.ts", text)).toEqual([]);
  });

  it.each([
    ["a literal static stream path", 'export const url = "/Videos/x/stream?static=true";'],
    ["a templated stream path", "export const url = (id: string) => `${id}/stream.mkv`;"],
    ["a playlist name", 'export const url = "master.m3u8";'],
    ["the static flag", 'export const url = "?Static=true";'],
    ["a URL after a string that looks like a comment", 'export const url = "https://media.test/Videos/x";'],
    ["the static URL builder", "export const url = buildStaticStreamUrl();"],
    ["an import of the HLS URL rebuild", 'import { rebuildMasterUrl } from "@octave/core/src/jellyfin/hls-url";\nexport const used = rebuildMasterUrl;'],
    ["a re-export of the launch request", 'export * from "@octave/core/src/player/launch-request";'],
    ["a require of the device profile", 'export const profile = require("@octave/core/src/jellyfin/device-profile");'],
    ["a dynamic import of the launch request", 'export const load = () => import("@octave/core/src/player/launch-request");'],
  ])("T8-03 item 1: the scan fails %s", (_name, text) => {
    expect(violationsOf("sample.ts", text)).not.toEqual([]);
  });
});
