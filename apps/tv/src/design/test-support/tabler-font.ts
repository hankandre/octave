// Reads the installed Tabler font and stylesheet for the T3-34 tests (docs/specs/T3-34.md, items 3). The package is a
// dependency of apps/tv, so pnpm links it under apps/tv/node_modules. apps/tv has no Node type definitions, so the Node
// modules are typed here by what the tests call.
declare const __dirname: string;

type Bytes = {
  readUInt16BE(offset: number): number;
  readUInt32BE(offset: number): number;
  toString(encoding: "latin1", start: number, end: number): string;
};
const { readFileSync } = require("fs") as {
  readFileSync(path: string): Bytes;
  readFileSync(path: string, encoding: "utf8"): string;
};
const { join } = require("path") as { join(...parts: string[]): string };

const TV_ROOT = join(__dirname, "..", "..", "..");
export const TABLER_DIST = join(TV_ROOT, "node_modules", "@tabler", "icons-webfont", "dist");

/** The text of `.ti-<name>:before`'s `content`, as a codepoint, from the weight-300 stylesheet. */
export function cssCodepoint(name: string): number | undefined {
  const css = readFileSync(join(TABLER_DIST, "tabler-icons-300.css"), "utf8");
  const escaped = name.replace(/[^a-z0-9-]/g, "");
  const rule = new RegExp(`\\.ti-${escaped}:before\\s*\\{[^}]*?content:\\s*["']\\\\([0-9a-fA-F]+)["']`).exec(css);
  return rule === null ? undefined : parseInt(rule[1], 16);
}

/** Every codepoint range in the weight-300 TTF's format 12 cmap subtable, read from the file's own tables. */
export function cmapRanges(): { start: number; end: number }[] {
  const font = readFileSync(join(TABLER_DIST, "fonts", "tabler-icons-300.ttf"));
  const tableCount = font.readUInt16BE(4);
  let cmapOffset = -1;
  for (let i = 0; i < tableCount; i += 1) {
    const record = 12 + 16 * i;
    if (font.toString("latin1", record, record + 4) === "cmap") cmapOffset = font.readUInt32BE(record + 8);
  }
  if (cmapOffset < 0) throw new Error("the TTF has no cmap table");
  const subtables = font.readUInt16BE(cmapOffset + 2);
  for (let i = 0; i < subtables; i += 1) {
    const sub = cmapOffset + font.readUInt32BE(cmapOffset + 4 + 8 * i + 4);
    if (font.readUInt16BE(sub) !== 12) continue;
    const groups = font.readUInt32BE(sub + 12);
    const ranges: { start: number; end: number }[] = [];
    for (let g = 0; g < groups; g += 1) {
      const at = sub + 16 + 12 * g;
      ranges.push({ start: font.readUInt32BE(at), end: font.readUInt32BE(at + 4) });
    }
    return ranges;
  }
  throw new Error("the TTF has no format 12 cmap subtable");
}

export function inRanges(ranges: { start: number; end: number }[], codepoint: number): boolean {
  return ranges.some((range) => codepoint >= range.start && codepoint <= range.end);
}
