// T8-25 item 4, code half: the filtered native reason goes only to the FailureLog sink that the caller passes, never
// into an action, the state, an event or a prop. (docs/specs/T8-25.md, Acceptance 4.)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { PLAYBACK_FAILURE_CODES } from "../domain/playback-failure";
import { failureAction, reportingWarningAction } from "./session-failure";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../../..");

const nativeReason =
  "mpv could not open https://media.test/Videos/x/stream?api_key=SECRET-TOKEN from /home/u/x.mkv (Authorization: MediaBrowser Token=SECRET-TOKEN)";
const LEAKS = ["SECRET-TOKEN", "api_key", "media.test", "/home/u", "x.mkv"];

describe("T8-25 item 4: the failure log sink", () => {
  it.each([
    ["a string", nativeReason],
    ["an Error", new Error(nativeReason)],
  ])("T8-25 item 4: %s reaches the sink once, filtered, and the action holds only a code", (_name, error) => {
    const log = vi.fn();
    const action = failureAction(error, log);
    expect(log).toHaveBeenCalledTimes(1);
    const reason: unknown = log.mock.calls[0]?.[0];
    if (typeof reason !== "string") throw new Error("expected the sink to receive a string");
    expect(reason).toContain("[path]");
    for (const leak of LEAKS) expect(reason).not.toContain(leak);
    expect(action).toEqual({ type: "failure", code: "request-failed" });
    for (const value of Object.values(action)) {
      if (typeof value === "string") expect(["failure", ...PLAYBACK_FAILURE_CODES]).toContain(value);
    }
    expect(JSON.stringify(action)).not.toContain("[path]");
  });

  it("T8-25 item 4: a transport failure also reaches the sink exactly once", () => {
    const log = vi.fn();
    const action = failureAction(Object.assign(new Error("HTTP 503 from jellyfin.home.lan"), { code: "status", status: 503 }), log);
    expect(action).toEqual({ type: "failure", code: "server-error" });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("T8-25 item 4: a reporting warning that is not a code goes to the sink, a code does not", () => {
    const log = vi.fn();
    reportingWarningAction("report-failed", log);
    reportingWarningAction(undefined, log);
    expect(log).not.toHaveBeenCalled();
    const action = reportingWarningAction("The conversion could not be stopped.", log);
    expect(log).toHaveBeenCalledTimes(1);
    expect(typeof log.mock.calls[0]?.[0]).toBe("string");
    expect(action.type).toBe("reporting-warning");
    expect(JSON.stringify(action)).not.toContain("conversion");
  });
});

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) found.push(path);
  }
  return found;
}

describe("T8-25 item 4: errorReason has one caller", () => {
  it("T8-25 item 4: only session-failure.ts imports errorReason, in the core and the app", () => {
    const importers = [...sourceFiles(join(repo, "packages/core/src")), ...sourceFiles(join(repo, "apps/tv/src"))]
      .filter((path) => /\b(?:import|export)\b[^{;]*\{[^}]*\berrorReason\b[^}]*\}\s*from\b/.test(readFileSync(path, "utf8")))
      .map((path) => relative(repo, path));
    expect(importers).toEqual(["packages/core/src/player/session-failure.ts"]);
  });
});
