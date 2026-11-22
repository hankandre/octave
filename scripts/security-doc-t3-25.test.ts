// @vitest-environment node
// T3-25 item 5 (docs/specs/T3-25.md, "Documents"): docs/security.md states the depth bound and names its tests in the
// same pull request.
//
// - The depth row is the table row that names AnswerDepthTest; its last cell's first word is Tested, and it holds 64,
//   StackOverflowError, OutOfMemoryError and unexpected-response and names ParserErrorCodeTest.
// - The caps row (the one that names ResponseCapTest) also names ResponseCapEdgeTest.
// - Every file those rows name in backticks exists (the rule of security-doc-t3-16.test.ts).
// - No line says a T3-25 claim is still planned.
// - No docs/specs/*.tests.json lists ResponseCapEdgeTest in its files, so item 3's tests stay in files no manifest
//   freezes (spec-check note 3). Manifests are parsed and only their files are read, since a gate's why may name it.
// Rows are found by what they name, never by number. Wording beyond these names is the implementer's and the review's.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const lines = readFileSync(join(repo, "docs", "security.md"), "utf8").split("\n");

// Table rows of claims: lines that start with `|`, without the header and separator rows.
const rows = lines.filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line) && !/^\|\s*Claim\s*\|/.test(line));

function lastCell(row: string): string {
  const body = row.trim().replace(/\|\s*$/, "");
  return body.slice(body.lastIndexOf(" | ") + 3).trim();
}

const firstWord = (text: string) => /^[A-Za-z]+/.exec(text)?.[0] ?? "";

const depthRows = () => rows.filter((row) => row.includes("AnswerDepthTest"));
const capRows = () => rows.filter((row) => row.includes("ResponseCapTest"));

// Every repository file under these roots, by base name, for rows that name a file without its directory.
function baseNames(): Set<string> {
  const names = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "build" || entry === ".git" || (entry === "android" && dir.endsWith(join("apps", "tv")))) continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else names.add(entry);
    }
  };
  for (const root of ["modules", "scripts", "packages", "apps", "docs", "tests", ".github"]) if (existsSync(join(repo, root))) walk(join(repo, root));
  return names;
}

const FILE = /^[\w.@/-]+\.(?:kt|java|ts|tsx|mjs|js|json|md|yml|yaml|gradle|txt)$/;

describe("docs/security.md after T3-25", () => {
  it("T3-25 item 5: a table row names AnswerDepthTest and says Tested", () => {
    const found = depthRows();
    expect(found.length, "rows naming AnswerDepthTest").toBeGreaterThan(0);
    for (const row of found) expect(firstWord(lastCell(row)), `the row naming AnswerDepthTest: ${row.slice(0, 120)}`).toBe("Tested");
  });

  it("T3-25 item 5: the depth row states the bound, the two errors and their code, and names ParserErrorCodeTest", () => {
    const found = depthRows();
    expect(found.length, "rows naming AnswerDepthTest").toBeGreaterThan(0);
    for (const row of found) {
      expect(row, "the bound").toMatch(/\b64\b/);
      for (const word of ["StackOverflowError", "OutOfMemoryError", "unexpected-response", "ParserErrorCodeTest"]) {
        expect(row.includes(word), `the depth row names ${word}`).toBe(true);
      }
    }
  });

  it("T3-25 item 5: the caps row also names ResponseCapEdgeTest", () => {
    const found = capRows();
    expect(found.length, "rows naming ResponseCapTest").toBeGreaterThan(0);
    expect(found.some((row) => row.includes("ResponseCapEdgeTest")), "a row naming ResponseCapTest also names ResponseCapEdgeTest").toBe(true);
  });

  it("T3-25 item 5: every file the depth and caps rows name exists", () => {
    const names = baseNames();
    const named = [...depthRows(), ...capRows()];
    expect(named.length, "the depth and caps rows").toBeGreaterThan(0);
    for (const row of named) {
      for (const match of row.matchAll(/`([^`]+)`/g)) {
        const token = match[1];
        if (!FILE.test(token) || token.startsWith("apps/tv/android/") || token.startsWith("release-evidence/")) continue;
        const found = token.includes("/") ? existsSync(join(repo, token)) : names.has(token);
        expect(found, `${token}, named in: ${row.slice(0, 120)}`).toBe(true);
      }
    }
  });

  it("T3-25 item 5: no line says a T3-25 claim is still planned", () => {
    expect(lines.filter((line) => /Planned[^.;|]*T3-25/.test(line))).toEqual([]);
  });

  it("T3-25 item 5: no manifest freezes ResponseCapEdgeTest", () => {
    const specs = join(repo, "docs", "specs");
    const listing = readdirSync(specs).filter((name) => name.endsWith(".tests.json"));
    expect(listing.length, "manifests under docs/specs").toBeGreaterThan(0);
    for (const name of listing) {
      const manifest = JSON.parse(readFileSync(join(specs, name), "utf8")) as { files?: unknown };
      const files = Array.isArray(manifest.files) ? manifest.files.filter((file): file is string => typeof file === "string") : [];
      expect(files.filter((file) => file.includes("ResponseCapEdgeTest")), `${name} lists ResponseCapEdgeTest`).toEqual([]);
    }
  });
});
