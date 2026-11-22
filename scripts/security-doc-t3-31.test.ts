// @vitest-environment node
// T3-31 item 4 (docs/specs/T3-31.md, "Documents"): docs/security.md and docs/commands.md say which checks the e2e APK
// gets before pnpm tv:e2e installs it, in the same pull request. Rows are found by what they name, never by number.
// The green tv job is evidence outside this manifest.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const security = readFileSync(join(repo, "docs", "security.md"), "utf8");
const commands = readFileSync(join(repo, "docs", "commands.md"), "utf8");
const plain = (text: string) => text.replace(/`/g, "").replace(/\s+/g, " ").trim();

const rows = security.split("\n").filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line));
const lastCell = (row: string) => {
  const body = row.trim().replace(/\|\s*$/, "");
  return body.slice(body.lastIndexOf(" | ") + 3).trim();
};
const row = rows.find((line) => line.includes("scripts/tv-e2e-apk.mjs"));

describe("T3-31 item 4: the e2e APK's checks are documented", () => {
  it("T3-31 item 4: a security.md claim row names scripts/tv-e2e-apk.mjs and its last cell starts with Tested", () => {
    expect(row, "a table row naming scripts/tv-e2e-apk.mjs").toBeDefined();
    expect(plain(lastCell(row as string))).toMatch(/^Tested/);
  });

  it("T3-31 item 4: the row's last cell names both tests, the build mapping test and pnpm tv:wire as not covered", () => {
    const cell = plain(lastCell(row as string));
    for (const text of ["scripts/tv-e2e-apk.test.ts", "scripts/tv-e2e-stop.test.ts", "scripts/tv-build-mapping.test.ts", "pnpm tv:wire"]) {
      expect(cell, text).toContain(text);
    }
  });

  it("T3-31 item 4: the row names T3-31 and the matching of the mapping to the dex by pg_map_id", () => {
    const text = plain(row as string);
    expect(text).toContain("T3-31");
    expect(text).toContain("pg_map_id");
  });

  it("T3-31 item 4: docs/commands.md names scripts/tv-e2e-apk.mjs", () => {
    expect(commands).toContain("scripts/tv-e2e-apk.mjs");
  });

  it("T3-31 item 4: the commands.md text after pnpm tv:e2e:build up to the next pnpm tv: command holds 'mapping'", () => {
    const start = commands.indexOf("pnpm tv:e2e:build");
    expect(start, "docs/commands.md names pnpm tv:e2e:build").toBeGreaterThan(-1);
    const rest = commands.slice(start + "pnpm tv:e2e:build".length);
    const next = rest.search(/pnpm tv:/);
    const passage = next === -1 ? rest : rest.slice(0, next);
    expect(passage).toContain("mapping");
  });
});
