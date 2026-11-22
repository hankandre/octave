// @vitest-environment node
// T3-28 item 6 (docs/specs/T3-28.md, "Documents"): docs/security.md section 1's inspector row, R5's reason and the two
// ReactHostImpl texts of the dex lists say what is now tested (scripts/tv-apk-native-inspector.mjs, a step of
// pnpm tv:apk:check) and what is still read from source, and docs/commands.md names the new step.
//
// Every assertion is an exact string or a row lookup; rows are found by what they name, never by number. The PR
// call-out of item 6 is checked at review, not here.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");
const plain = (text: string) => text.replace(/`/g, "").replace(/\s+/g, " ").trim();

const SCRIPT = "scripts/tv-apk-native-inspector.mjs";

function lastCell(row: string): string {
  const body = row.trim().replace(/\|\s*$/, "");
  return body.slice(body.lastIndexOf(" | ") + 3).trim();
}

async function load(path: string): Promise<Record<string, unknown>> {
  return (await import(pathToFileURL(join(repo, path)).href)) as Record<string, unknown>;
}

describe("T3-28 item 6: docs/security.md says what the native inspector check tests and what is still read", () => {
  const doc = read("docs/security.md");
  const rows = doc.split("\n").filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line));

  it("T3-28 item 6: the release_build_has_no_inspector row names the check, says Tested, names both tests and what is read from source", () => {
    const named = rows.filter((row) => row.includes("release_build_has_no_inspector"));
    expect(named.length, "a row names release_build_has_no_inspector").toBeGreaterThan(0);
    const matching = named.filter((row) => {
      const cell = plain(lastCell(row));
      return (
        row.includes(SCRIPT) &&
        /^Tested\b/.test(cell) &&
        cell.includes("scripts/tv-apk-native-inspector.test.ts") &&
        cell.includes("scripts/tv-apk-inspector-cli.test.ts") &&
        cell.includes("read from source")
      );
    });
    expect(matching.length, named.map((row) => row.slice(0, 160)).join("\n")).toBeGreaterThan(0);
  });

  it("T3-28 item 6: the paragraph on what the dex check cannot see names the native inspector check", () => {
    const start = doc.indexOf("**What the dex check cannot see.**");
    expect(start, "the paragraph **What the dex check cannot see.**").toBeGreaterThan(-1);
    const rest = doc.slice(start);
    const end = rest.search(/\n\s*\n/);
    const paragraph = end === -1 ? rest : rest.slice(0, end);
    expect(paragraph).toContain(SCRIPT);
  });

  it("T3-28 item 6: no line says the C++ inspector gate is read from source and not tested", () => {
    expect(doc.includes("whose C++ inspector gate is read from source and not tested"), "docs/security.md still says the C++ inspector gate is untested").toBe(false);
  });
});

describe("T3-28 item 6: R5's reason and the dex lists' ReactHostImpl texts name the check", () => {
  it("T3-28 item 6: R5's reason names the check as Tested (T3-28), keeps what is read from source, and drops the backlog line", async () => {
    const paths = (await load("scripts/linked-network-paths.mjs")).LINKED_NETWORK_PATHS as { id: string; reason: string }[];
    const r5 = paths.filter((entry) => entry.id === "R5");
    expect(r5.length).toBeGreaterThan(0);
    for (const row of r5) {
      const reason = plain(row.reason);
      for (const words of [SCRIPT, "Tested (T3-28)", "read from source", "not tested"]) expect(reason, `R5's reason holds "${words}"`).toContain(words);
      expect(reason).not.toContain("a backlog line asks for the test");
    }
  });

  it("T3-28 item 6: the R5 entry point's reason names the check and no longer says its gate is untested", async () => {
    const entries = (await load("scripts/tv-apk-dex-lists.mjs")).APK_NETWORK_ENTRY_POINTS as { linkedPath?: string; reason: string }[];
    const r5 = entries.filter((entry) => entry.linkedPath === "R5");
    expect(r5.length).toBeGreaterThan(0);
    for (const entry of r5) {
      expect(entry.reason).toContain(SCRIPT);
      expect(entry.reason).not.toContain("whose gate is read from source and not tested");
    }
  });

  it("T3-28 item 6: ReactHostImpl's offInRelease names the check", async () => {
    const callers = (await load("scripts/tv-apk-dex-lists.mjs")).DEV_SUPPORT_CLIENT_CALLERS as { class: string; offInRelease: string }[];
    const host = callers.filter((caller) => caller.class === "com.facebook.react.runtime.ReactHostImpl");
    expect(host.length).toBeGreaterThan(0);
    for (const caller of host) expect(caller.offInRelease).toContain(SCRIPT);
  });
});

describe("T3-28 item 6: docs/commands.md names the new step", () => {
  it("T3-28 item 6: docs/commands.md names scripts/tv-apk-native-inspector.mjs", () => {
    expect(read("docs/commands.md")).toContain(SCRIPT);
  });
});
