// @vitest-environment node
// T3-27 item 2, unit half (the device half is gate: ci): the wire runner takes each fixture's upstream port from the
// checkout's record, not from a stale _url in .credentials, and starts the fixtures when a recorded origin does not
// answer. Record and credentials live in temp dirs; answers and pnpm are fakes.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureFixtures, fixtureTargets, readWireCredentials, upstreamPort } from "./tv-wire-fixtures.mjs";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const recordText = (a: number, b: number, c: number) =>
  `OCTAVE_FIXTURE_PORT_JELLYFIN_10_11=${a}\nOCTAVE_FIXTURE_PORT_JELLYFIN_12=${b}\nOCTAVE_FIXTURE_PORT_JELLYSCALE=${c}\n`;
const TARGETS = ["jellyfin-10-11", "jellyfin-12", "jellyscale"];

function setup(options: { passwords?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "octave-wire-ports-"));
  dirs.push(dir);
  const recordFile = join(dir, ".fixture-ports");
  const credentialsFile = join(dir, ".credentials");
  writeFileSync(recordFile, recordText(28101, 28102, 28103));
  const stale = TARGETS.map((target, index) => `${target}_url=http://127.0.0.1:${18096 + index}`);
  const passwords = options.passwords === false ? [] : TARGETS.map((target) => `${target}_password=secret`);
  writeFileSync(credentialsFile, [...stale, ...passwords].join("\n") + "\n");
  return { recordFile, credentialsFile };
}

describe("T3-27 item 2: the wire runner uses the checkout's recorded fixture ports", () => {
  it("T3-27 item 2: upstreamPort gives the recorded ports over a stale .credentials", () => {
    const { recordFile, credentialsFile } = setup();
    const credentials = readWireCredentials(credentialsFile, recordFile);
    expect(TARGETS.map((target) => upstreamPort(target, credentials))).toEqual([28101, 28102, 28103]);
    expect(credentials["jellyscale_password"]).toBe("secret");
  });

  it("T3-27 item 2: without a credentials file the credentials are the record's origins", () => {
    const { recordFile, credentialsFile } = setup();
    rmSync(credentialsFile);
    const credentials = readWireCredentials(credentialsFile, recordFile);
    expect(upstreamPort("jellyscale", credentials)).toBe(28103);
  });

  it("T3-27 item 2: fixtureTargets gives the recorded origins", () => {
    const { recordFile } = setup();
    expect(fixtureTargets(recordFile)).toEqual({
      "jellyfin-10-11": "http://127.0.0.1:28101",
      "jellyfin-12": "http://127.0.0.1:28102",
      jellyscale: "http://127.0.0.1:28103",
    });
  });

  it("T3-27 item 2: ensureFixtures probes the recorded origins and starts nothing when all answer", async () => {
    const { recordFile, credentialsFile } = setup();
    const probed: string[] = [];
    const ran: string[] = [];
    await ensureFixtures(["jellyscale", "jellyfin-12"], {
      recordFile,
      credentialsFile,
      answers: async (url: string) => (probed.push(url), true),
      pnpm: (script: string) => void ran.push(script),
    });
    expect(probed.sort()).toEqual(["http://127.0.0.1:28102", "http://127.0.0.1:28103"]);
    expect(ran).toEqual([]);
  });

  it("T3-27 item 2: ensureFixtures runs pnpm fixture:up when one does not answer, then reads the rewritten record", async () => {
    const { recordFile, credentialsFile } = setup();
    const probed: string[] = [];
    const ran: string[] = [];
    await ensureFixtures(["jellyscale"], {
      recordFile,
      credentialsFile,
      answers: async (url: string) => (probed.push(url), false),
      pnpm: (script: string) => {
        ran.push(script);
        if (script === "fixture:up") writeFileSync(recordFile, recordText(29101, 29102, 29103));
      },
    });
    expect(ran[0]).toBe("fixture:up");
    expect(probed).toEqual(["http://127.0.0.1:28103"]);
    // The credentials the runner reads next carry the new record's port, not the old one.
    expect(upstreamPort("jellyscale", readWireCredentials(credentialsFile, recordFile))).toBe(29103);
  });

  it("T3-27 item 2: ensureFixtures runs pnpm fixture:setup when a target has no password", async () => {
    const { recordFile, credentialsFile } = setup({ passwords: false });
    const ran: string[] = [];
    await ensureFixtures(["jellyscale"], {
      recordFile,
      credentialsFile,
      answers: async () => true,
      pnpm: (script: string) => void ran.push(script),
    });
    expect(ran).toEqual(["fixture:setup"]);
  });
});
