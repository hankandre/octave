// T3-27: where the wire runner finds the pinned fixture servers. Each checkout chooses its own host ports
// (tests/integration/fixture-ports.mjs records them in tests/integration/.fixture-ports), so the runner reads the
// origins from that record and lets it win over a stale <name>_url in .credentials. Its recorders take the fixture's
// port as their upstream; the emulator reaches a fixture only through `adb reverse` to its pair's recorder.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RECORD, fixtureOrigins, withFixtureOrigins } from "../tests/integration/fixture-ports.mjs";
import { serverAnswers } from "./tv-wire-proxy.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
const CREDENTIALS = join(repo, "tests", "integration", ".credentials");

// The credentials file's values (none when it is absent), each <name>_url set to the record's origin.
export function readWireCredentials(credentialsFile = CREDENTIALS, recordFile = RECORD) {
  const values = existsSync(credentialsFile)
    ? Object.fromEntries(
        readFileSync(credentialsFile, "utf8")
          .split("\n")
          .filter((line) => line.includes("="))
          .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
      )
    : {};
  return withFixtureOrigins(values, fixtureOrigins(recordFile));
}

// The fixtures' origins, by target name.
export function fixtureTargets(recordFile = RECORD) {
  return fixtureOrigins(recordFile);
}

// The port a target's recorder uses as its upstream.
export function upstreamPort(target, credentials) {
  return Number(new URL(credentials[`${target}_url`]).port);
}

function runPnpm(script) {
  const run = spawnSync("pnpm", [script], { cwd: repo, stdio: ["ignore", "inherit", "inherit"] });
  if (run.status !== 0) throw new Error(`pnpm ${script} failed`);
}

// Starts the fixture servers when a selected target does not answer at its recorded origin, then reads the record again
// (pnpm fixture:up may have chosen new ports) and sets the users up when one is missing; both steps are safe to repeat.
export async function ensureFixtures(
  targets,
  { recordFile = RECORD, credentialsFile = CREDENTIALS, answers = serverAnswers, pnpm = runPnpm } = {},
) {
  const origins = fixtureTargets(recordFile);
  const healthy = (await Promise.all(targets.map((target) => answers(origins[target])))).every(Boolean);
  if (!healthy) pnpm("fixture:up");
  const credentials = readWireCredentials(credentialsFile, recordFile);
  if (!healthy || targets.some((target) => credentials[`${target}_password`] === undefined)) pnpm("fixture:setup");
}
