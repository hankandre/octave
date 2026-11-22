// @vitest-environment node
// T3-27 review follow-ups: a checkout with no port record starts its own fixtures instead of trusting the default
// origins, the temporary record file is ignored by git, and the wire runner's recorder upstream comes from the record.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureFixtures } from "./tv-wire-fixtures.mjs";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("T3-27 review: ensureFixtures without a record", () => {
  it("runs pnpm fixture:up and fixture:setup even when the default origins answer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "octave-wire-norecord-"));
    dirs.push(dir);
    const recordFile = join(dir, ".fixture-ports");
    const credentialsFile = join(dir, ".credentials");
    writeFileSync(credentialsFile, ["jellyscale_password=secret"].join("\n") + "\n");
    const ran: string[] = [];
    await ensureFixtures(["jellyscale"], {
      recordFile,
      credentialsFile,
      answers: async () => true,
      pnpm: (script: string) => void ran.push(script),
    });
    expect(ran).toEqual(["fixture:up", "fixture:setup"]);
  });
});

describe("T3-27 review: wiring", () => {
  it("git ignores the temporary record file", () => {
    const out = execFileSync("git", ["check-ignore", "tests/integration/.fixture-ports.tmp"], { encoding: "utf8" });
    expect(out.trim()).toBe("tests/integration/.fixture-ports.tmp");
  });

  it("tv-wire.mjs takes a fixture pair's recorder upstream from upstreamPort", () => {
    const source = readFileSync(new URL("./tv-wire.mjs", import.meta.url), "utf8");
    expect(source).toContain("upstream = { port: upstreamPort(pair.target, credentials) };");
  });
});
