// @vitest-environment node
// T3-16 item 6 (docs/specs/T3-16.md, "Documents"): docs/security.md marks each of T3-16's tests as tested in the same
// pull request.
//
// - No line says a T3-16 claim is still planned: nothing matches `Planned[^.;|]*T3-16` (one clause, so a row may say
//   "Planned: ... (T10-02)" beside a T3-16 test).
// - Each of T3-16's test names, files and checks appears in a table row, and every table row that names one has a last
//   cell whose first word is Tested. Rows are found by what they name, never by number, and their status is read by
//   its first word only, so the rows T3-19 also rewrites hold on either merge order.
// - Every file those rows name in backticks exists, other than build outputs (apps/tv/android/) and CI evidence
//   (release-evidence/).
// - The caps row names the three caps.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const doc = readFileSync(join(repo, "docs", "security.md"), "utf8");
const lines = doc.split("\n");

const NAMES = [
  "request_refuses_headers_absolute_urls_and_other_origins",
  "RequestSeamTest",
  "an_echoed_token_is_removed_from_response_bodies",
  "EchoedTokenTest",
  "kotlin_header_matches_the_recorded_vector",
  "HeaderVectorControlTest",
  "release_build_has_no_inspector",
  "pnpm lint:logs",
  "RequestPathTest",
  "ResponseCapTest",
];

// Table rows of claims: lines that start with `|`, without the header and separator rows.
const rows = lines.filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line) && !/^\|\s*Claim\s*\|/.test(line));

function lastCell(row: string): string {
  const body = row.trim().replace(/\|\s*$/, "");
  return body.slice(body.lastIndexOf(" | ") + 3).trim();
}

const firstWord = (text: string) => /^[A-Za-z]+/.exec(text)?.[0] ?? "";

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

describe("docs/security.md after T3-16", () => {
  it("T3-16 item 6: no line says a T3-16 claim is still planned", () => {
    const planned = lines.filter((line) => /Planned[^.;|]*T3-16/.test(line));
    expect(planned).toEqual([]);
  });

  it("T3-16 item 6: each T3-16 test is named in a table row", () => {
    for (const name of NAMES) expect(rows.some((row) => row.includes(name)), `a row names ${name}`).toBe(true);
  });

  it("T3-16 item 6: every row that names a T3-16 test says Tested", () => {
    for (const name of NAMES) {
      for (const row of rows.filter((line) => line.includes(name))) {
        expect(firstWord(lastCell(row)), `the row naming ${name}: ${row.slice(0, 120)}`).toBe("Tested");
      }
    }
  });

  it("T3-16 item 6: every file those rows name exists", () => {
    const names = baseNames();
    for (const row of rows.filter((line) => NAMES.some((name) => line.includes(name)))) {
      for (const match of row.matchAll(/`([^`]+)`/g)) {
        const token = match[1];
        // Build outputs and CI evidence do not exist in a checkout that has not built.
        if (!FILE.test(token) || token.startsWith("apps/tv/android/") || token.startsWith("release-evidence/")) continue;
        const found = token.includes("/") ? existsSync(join(repo, token)) : names.has(token);
        expect(found, `${token}, named in: ${row.slice(0, 120)}`).toBe(true);
      }
    }
  });

  it("T3-16 item 6: the caps row names the three caps", () => {
    const capRows = rows.filter((row) => row.includes("ResponseCapTest"));
    expect(capRows.length).toBeGreaterThan(0);
    for (const size of ["1 MiB", "4 MiB", "8 MiB"]) expect(capRows.some((row) => row.includes(size)), size).toBe(true);
  });
});
