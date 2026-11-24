// T3-34 item 3: no screen names a codepoint. Only design/icon.ts holds them. The scanner fails any hex literal, escape or raw
// character whose value is in the Tabler font's cmap, and any String.fromCodePoint or String.fromCharCode call, in the app's
// source. Decimal numbers are left out on purpose: a timeout such as 60000 is U+EA60. This is a Jest file (not Vitest) so the
// manifest's one run for item 3 covers it together with icon.test.tsx.
import { describe, expect, it } from "@jest/globals";
import { cmapRanges, inRanges } from "./test-support/tabler-font";

declare const __dirname: string;
const { readdirSync, readFileSync } = require("fs") as {
  readdirSync(dir: string, options: { withFileTypes: true }): { name: string; isFile(): boolean; isDirectory(): boolean }[];
  readFileSync(path: string, encoding: "utf8"): string;
};
const { join, relative } = require("path") as { join(...parts: string[]): string; relative(from: string, to: string): string };

type InCmap = (codepoint: number) => boolean;

/** Every codepoint-naming form in `source`, each as a short description. */
export function findCodepoints(source: string, inCmap: InCmap): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/\b0[xX]([0-9a-fA-F_]+)\b/g)) {
    const value = parseInt(match[1].replace(/_/g, ""), 16);
    if (inCmap(value)) found.push(`hex literal ${match[0]}`);
  }
  const escapes = /\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})(?:\\u([dD][c-fC-F][0-9a-fA-F]{2}))?/g;
  for (const match of source.matchAll(escapes)) {
    let value: number;
    if (match[1] !== undefined) value = parseInt(match[1], 16);
    else {
      value = parseInt(match[2], 16);
      const low = match[3];
      if (low !== undefined && value >= 0xd800 && value <= 0xdbff) value = 0x10000 + ((value - 0xd800) << 10) + (parseInt(low, 16) - 0xdc00);
    }
    if (inCmap(value)) found.push(`escape ${match[0]}`);
  }
  for (const character of Array.from(source)) {
    const value = character.codePointAt(0) as number;
    if (value > 0x7f && inCmap(value)) found.push(`raw character U+${value.toString(16).toUpperCase()}`);
  }
  for (const call of source.matchAll(/String\s*\.\s*(fromCodePoint|fromCharCode)\s*\(/g)) found.push(`String.${call[1]} call`);
  return found;
}

function sourceFiles(dir: string, root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const rel = relative(root, path).split("\\").join("/");
    if (entry.isDirectory()) {
      if (entry.name === "test-support" || entry.name === "e2e") continue;
      files.push(...sourceFiles(path, root));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) && rel !== "design/icon.ts") {
      files.push(path);
    }
  }
  return files;
}

const fake: InCmap = (codepoint) => codepoint === 0xea5e || codepoint === 0x10001;

describe("T3-34 item 3: the codepoint scanner", () => {
  it("T3-34 item 3: catches a hex literal, a \\u escape, a \\u{} escape, a surrogate pair and a raw character", () => {
    expect(findCodepoints("const a = 0xea5e;", fake)).toHaveLength(1);
    expect(findCodepoints("const a = 0x1_0001;", fake)).toHaveLength(1);
    expect(findCodepoints('const a = "\\uea5e";', fake)).toHaveLength(1);
    expect(findCodepoints('const a = "\\u{ea5e}";', fake)).toHaveLength(1);
    expect(findCodepoints('const a = "\\u{10001}";', fake)).toHaveLength(1);
    expect(findCodepoints('const a = "\\ud800\\udc01";', fake)).toHaveLength(1);
    expect(findCodepoints(`const a = "${String.fromCodePoint(0xea5e)}";`, fake)).toHaveLength(1);
    expect(findCodepoints(`const a = "${String.fromCodePoint(0x10001)}";`, fake)).toHaveLength(1);
  });

  it("T3-34 item 3: catches String.fromCodePoint and String.fromCharCode calls", () => {
    expect(findCodepoints("const a = String.fromCodePoint(n);", fake)).toHaveLength(1);
    expect(findCodepoints("const a = String.fromCharCode(n);", fake)).toHaveLength(1);
    expect(findCodepoints("const a = String . fromCodePoint (n);", fake)).toHaveLength(1);
  });

  it("T3-34 item 3: leaves a decimal, a hex outside the font, and an ordinary escape or character alone", () => {
    expect(findCodepoints("const a = 60000;", () => true)).toEqual([]);
    expect(findCodepoints("const a = 0x00ff;", fake)).toEqual([]);
    expect(findCodepoints('const a = "\\u0041 \\u{41}";', fake)).toEqual([]);
    expect(findCodepoints('const a = "caf\u00e9 \u2014";', fake)).toEqual([]);
  });
});

describe("T3-34 item 3: the app's source", () => {
  it("T3-34 item 3: names no codepoint of the Tabler font outside design/icon.ts", () => {
    const ranges = cmapRanges();
    const root = join(__dirname, "..");
    const files = sourceFiles(root, root);
    expect(files.length).toBeGreaterThan(20);
    const offences: string[] = [];
    for (const file of files) {
      for (const finding of findCodepoints(readFileSync(file, "utf8"), (codepoint) => inRanges(ranges, codepoint))) {
        offences.push(`${relative(root, file)}: ${finding}`);
      }
    }
    expect(offences).toEqual([]);
  });
});
