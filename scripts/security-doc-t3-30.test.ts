// @vitest-environment node
// T3-30 item 6 (docs/specs/T3-30.md, "Documents"): docs/security.md and docs/commands.md say that console output and
// evidence hold no device address, in the same pull request. Found by their words, never by line number.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const security = readFileSync(join(repo, "docs", "security.md"), "utf8");
const commands = readFileSync(join(repo, "docs", "commands.md"), "utf8");

const rows = security.split("\n").filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line));
const lastCell = (row: string) => {
  const body = row.trim().replace(/\|\s*$/, "");
  return body.slice(body.lastIndexOf(" | ") + 3).trim();
};
const row = rows.find((line) => line.includes("scripts/tv-adb.mjs") && line.includes("[device]"));

describe("T3-30 item 6: the device address is documented", () => {
  it("T3-30 item 6: a security.md claim row names scripts/tv-adb.mjs and the stand-in, and is Tested (T3-30)", () => {
    expect(row, "a table row naming scripts/tv-adb.mjs and [device]").toBeDefined();
    expect(lastCell(row as string)).toMatch(/^Tested/);
    expect(row).toContain("T3-30");
  });

  it("T3-30 item 6: the row names its three tests, and every repository file it names exists", () => {
    for (const test of ["scripts/tv-adb.test.ts", "scripts/tv-adb-output.test.ts", "scripts/check-adb-output.test.ts"]) {
      expect(row, test).toContain(test);
    }
    const named = [...(row as string).matchAll(/`((?:scripts|docs|tests)\/[^`\s]+)`/g)].map((match) => match[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const path of named) expect(existsSync(join(repo, path)), `${path} exists`).toBe(true);
  });

  it("T3-30 item 6: the row says what it does not cover, and does not name pnpm lint:logs", () => {
    expect(row).toMatch(/address the serial does not contain/i);
    expect(row).toMatch(/screenshot/i);
    expect(row).not.toContain("pnpm lint:logs");
  });

  it("T3-30 item 6: commands.md says console output and evidence hold no device serial, written as [device]", () => {
    expect(commands).toContain("[device]");
    expect(commands).toMatch(/(console|output)[^.\n]*(evidence)[^.\n]*(serial|address)|(serial|address)[^.\n]*(console|output)[^.\n]*evidence/i);
  });

  it("T3-30 item 6: the pnpm tv:smoke passage names the host-wide lock and the failed-control rule", () => {
    const line = commands.split("\n").find((text) => text.includes("pnpm tv:smoke"));
    expect(line, "a commands.md line naming pnpm tv:smoke").toBeDefined();
    expect(line).toMatch(/one (pnpm tv:)?smoke (test |run )?per host/i);
    expect(line).toMatch(/process/i);
    expect(line).toMatch(/control[^.;]*fail|fail[^.;]*control/i);
  });

  it("T3-30 item 6: the T3-26 sentences the wire documents test stay", () => {
    expect(commands).toContain("SIGINT");
    expect(commands).toContain("SIGTERM");
    expect(commands).toContain("OCTAVE_WIRE_EVIDENCE");
  });
});
