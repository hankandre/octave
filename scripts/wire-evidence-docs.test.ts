// @vitest-environment node
// T3-26 item 6, the documents half (docs/specs/T3-26.md, "Documents"): docs/security.md and docs/commands.md say what the
// wire evidence holds in the same pull request. Loose patterns; the item itself is a CI gate (the wire job).
import { readFileSync } from "node:fs";
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
const FILES = ["summary.txt", "app-lines.txt", "device.txt", "global-proxy.txt"];

describe("T3-26 item 6: the wire evidence is documented", () => {
  it("T3-26 item 6: a security.md claim row names release-evidence/wire and the evidence test, and is Tested", () => {
    const row = rows.find((line) => line.includes("release-evidence/wire") && line.includes("scripts/tv-wire-evidence.test.ts"));
    expect(row, "a table row naming release-evidence/wire and scripts/tv-wire-evidence.test.ts").toBeDefined();
    expect(lastCell(row as string)).toMatch(/^Tested/);
  });

  it("T3-26 item 6: both documents name the five evidence files", () => {
    for (const [name, text] of [
      ["docs/security.md", security],
      ["docs/commands.md", commands],
    ] as const) {
      for (const file of FILES) expect(text.includes(file), `${name} names ${file}`).toBe(true);
      expect(/<test>-<target>\.jsonl|\.jsonl/.test(text), `${name} names the per-pair jsonl files`).toBe(true);
    }
  });

  it("T3-26 item 6: commands.md names SIGINT, SIGTERM and the removal at the start of every invocation", () => {
    expect(commands).toContain("SIGINT");
    expect(commands).toContain("SIGTERM");
    expect(commands).toMatch(/removed at the start|removes[^.\n]*at its start|removes[^.\n]*at the start/i);
    expect(commands).toContain("OCTAVE_WIRE_EVIDENCE");
  });

  it("T3-26 item 6: the pnpm lint:logs row names the new CLI test and stays Tested", () => {
    const row = rows.find((line) => line.includes("pnpm lint:logs"));
    expect(row).toBeDefined();
    expect(row).toContain("scripts/check-session-logs-cli.test.ts");
    expect(lastCell(row as string)).toMatch(/^Tested/);
  });
});
