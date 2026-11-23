// T8-25 item 2: each failure code names exactly one row of DESIGN.md's copy table, and the core holds that row's
// title, body and actions verbatim. A code with no row fails here; a missing sentence goes to the owner, never coined.
// Rows are found by their State cell, never by line number. (docs/specs/T8-25.md, Acceptance 2.)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PlaybackFailureCode } from "./playback-failure";
import {
  PLAYBACK_FAILURE_CODES,
  PLAYBACK_FAILURE_COPY,
  REPORTING_WARNING_CODES,
  playbackFailureForPlayerError,
} from "./playback-failure";
import { PLAYER_ERROR_CODES, type PlayerErrorCode } from "./player-engine";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const design = readFileSync(join(repo, "DESIGN.md"), "utf8");

interface Row {
  state: string;
  title: string;
  body: string;
  action: string;
}

const rows: Row[] = design
  .split("\n")
  .filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line))
  .map((line) => line.replace(/^\||\|\s*$/g, "").split("|").map((cell) => cell.trim()))
  .filter((cells) => cells.length === 4)
  .map(([state, title, body, action]) => ({ state, title, body, action }));

const ALL_CODES = [...PLAYBACK_FAILURE_CODES, ...REPORTING_WARNING_CODES] as const;
const copyOf = PLAYBACK_FAILURE_COPY as Record<string, { row: string; title?: string; body: string; actions: readonly string[] }>;

function actionsOf(cell: string): string[] {
  if (cell === "n/a") return [];
  return cell.replace(/\s*\([^)]*\)\s*$/, "").split(", ");
}

describe("T8-25 item 2: every code has one DESIGN.md row", () => {
  it("T8-25 item 2: the copy table has an entry for each code and no other", () => {
    expect(Object.keys(copyOf).sort()).toEqual([...ALL_CODES].sort());
  });

  it.each(ALL_CODES.map((code) => [code] as const))("T8-25 item 2: %s matches exactly one row verbatim", (code) => {
    const entry = copyOf[code];
    expect(entry, `no copy entry for ${code}`).toBeDefined();
    const found = rows.filter((row) => row.state === entry.row);
    expect(found.length, `no DESIGN.md row for ${code}: a missing sentence goes to the owner`).toBe(1);
    const [row] = found;
    expect(row.title, `${code} title`).toBe(entry.title ?? "n/a");
    expect(row.body, `${code} body`).toBe(entry.body);
    expect(actionsOf(row.action), `${code} actions`).toEqual([...entry.actions]);
  });

  it("T8-25 item 2: no two codes share a row", () => {
    const names = ALL_CODES.map((code) => copyOf[code].row);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("T8-25 item 2: the owner's wording of 2026-11-23 (option C)", () => {
  it.each([
    ["session-ended", "Your session on {server} has ended. Sign in again to keep watching.", ["Sign in", "Back to details"]],
    ["decoder-unavailable", "This device can't play this video or audio format.", ["Back to details"]],
    ["audio-output-failed", "Couldn't play the sound on this device. Check the TV's audio output, then try again.", ["Retry", "Back to details"]],
  ])("T8-25 item 2: %s holds the owner's title, body and actions", (code, body, actions) => {
    expect(PLAYBACK_FAILURE_CODES).toContain(code);
    expect(copyOf[code].title).toBe("Playback stopped");
    expect(copyOf[code].body).toBe(body);
    expect([...copyOf[code].actions]).toEqual(actions);
  });

  it("T8-25 item 2: the three owner rows are in DESIGN.md with the same wording", () => {
    for (const code of ["session-ended", "decoder-unavailable", "audio-output-failed"]) {
      const found = rows.filter((row) => row.state === copyOf[code]?.row);
      expect(found.length, `DESIGN.md row for ${code}`).toBe(1);
      expect(found[0].title).toBe("Playback stopped");
    }
  });
});

describe("T8-25 item 2: engine codes map to failure codes", () => {
  const expected: Record<PlayerErrorCode, PlaybackFailureCode> = {
    "network": "server-unreachable",
    "server-error": "server-error",
    "session-ended": "session-ended",
    "unsafe-playlist": "unsafe-stream",
    "unsupported-request": "request-failed",
    "malformed-media": "request-failed",
    "decoder-unavailable": "decoder-unavailable",
    "decoder-failed": "request-failed",
    "audio-output-failed": "audio-output-failed",
    "stop-failed": "stop-failed",
    "unknown": "request-failed",
  };

  it("T8-25 item 2: the table covers every engine code, so a new code fails until mapped", () => {
    expect(Object.keys(expected).sort()).toEqual([...PLAYER_ERROR_CODES].sort());
  });

  it.each(PLAYER_ERROR_CODES.map((code) => [code] as const))("T8-25 item 2: engine code %s maps as the owner ruled", (code) => {
    expect(playbackFailureForPlayerError(code)).toBe(expected[code]);
    expect(PLAYBACK_FAILURE_CODES).toContain(playbackFailureForPlayerError(code));
  });
});
