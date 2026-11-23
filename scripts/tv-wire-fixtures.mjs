// T3-27: where the wire runner finds the pinned fixture servers. Each checkout chooses its own host ports
// (tests/integration/fixture-ports.mjs records them in tests/integration/.fixture-ports), so the runner reads the
// origins from that record and lets it win over a stale <name>_url in .credentials. Its recorders take the fixture's
// port as their upstream; the emulator reaches a fixture only through `adb reverse` to its pair's recorder.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RECORD, fixtureOrigins, readRecord, withFixtureOrigins } from "../tests/integration/fixture-ports.mjs";
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

// Starts the fixture servers when this checkout has no record (the default origins may be another checkout's servers) or
// a selected target does not answer at its recorded origin, then reads the record again
// (pnpm fixture:up may have chosen new ports) and sets the users up when one is missing; both steps are safe to repeat.
export async function ensureFixtures(
  targets,
  { recordFile = RECORD, credentialsFile = CREDENTIALS, answers = serverAnswers, pnpm = runPnpm } = {},
) {
  const origins = fixtureTargets(recordFile);
  const recorded = readRecord(recordFile) !== null;
  const healthy = recorded && (await Promise.all(targets.map((target) => answers(origins[target])))).every(Boolean);
  if (!healthy) pnpm("fixture:up");
  const credentials = readWireCredentials(credentialsFile, recordFile);
  if (!healthy || targets.some((target) => credentials[`${target}_password`] === undefined)) pnpm("fixture:setup");
}

// T8-07 (Product Owner ruling on item 6): setup creates the Jellyfin libraries without scanning them, so the runner
// scans the library a selected wire test reads before the first pair runs. Only the tests on this list read a Jellyfin
// library; a Jellyscale or mock pair starts no scan.
export const READS_JELLYFIN_LIBRARY = ["player-capabilities"];
const JELLYFIN_TARGETS = ["jellyfin-10-11", "jellyfin-12"];
// The samples those tests look up, by file name (Jellyfin titles them from the NFO, so the name varies by server).
export const SCANNED_SAMPLES = ["Synthetic H264 (2024).mkv", "Synthetic No Decoder (2024).mkv"];
export const SCAN_LIMIT_MS = 120_000;
const SCAN_POLL_MS = 2_000;
const CLIENT = 'MediaBrowser Client="Octave Tests", Device="ci", DeviceId="octave-wire-scan", Version="0"';

// The Jellyfin targets whose library a selected pair reads, each once.
export function scanTargetsOf(pairs) {
  return [...new Set(pairs.filter((pair) => READS_JELLYFIN_LIBRARY.includes(pair.test) && JELLYFIN_TARGETS.includes(pair.target)).map((pair) => pair.target))];
}

// Signs in to each such target's fixture origin (never its recorder) with the fixture's admin user, sends
// POST /Library/Refresh, and waits until every scanned sample is listed as a movie and the scheduled tasks are idle on
// two polls in a row, within SCAN_LIMIT_MS. The token is added to `secrets` before it is used and appears in no message.
// A scan that does not settle throws with a plain line; the caller fails the run.
export async function scanJellyfinLibraries(
  pairs,
  { credentials, secrets, fetch = globalThis.fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now, log = console.log } = {},
) {
  for (const target of scanTargetsOf(pairs)) {
    const origin = credentials[`${target}_url`];
    const user = credentials[`${target}_username`];
    const password = credentials[`${target}_password`];
    if (!origin || !user || !password) throw new Error(`no fixture credentials for ${target}; run pnpm fixture:setup`);
    await scanOne(target, origin, user, password, { secrets, fetch, sleep, now, log });
  }
}

async function scanOne(target, origin, user, password, { secrets, fetch, sleep, now, log }) {
  const call = async (method, path, { token, body } = {}) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      redirect: "manual",
      headers: {
        Authorization: token === undefined ? CLIENT : `${CLIENT}, Token="${token}"`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status < 200 || response.status > 299) throw new Error(`${target}'s library scan failed: ${method} ${path} answered ${response.status}`);
    return response.status === 204 ? null : response.json();
  };

  const signedIn = await call("POST", "/Users/AuthenticateByName", { body: { Username: user, Pw: password } });
  const token = signedIn?.AccessToken;
  if (typeof token !== "string" || token === "") throw new Error(`${target}'s library scan failed: sign-in returned no token`);
  secrets.add(token);
  try {
    await call("POST", "/Library/Refresh", { token });
    const started = now();
    let listed = 0;
    let busy = 0;
    let quietPolls = 0;
    while (now() - started < SCAN_LIMIT_MS) {
      await sleep(SCAN_POLL_MS);
      const tasks = await call("GET", "/ScheduledTasks?isHidden=false", { token });
      const items = await call("GET", "/Items?Recursive=true&IncludeItemTypes=Movie&Fields=Path", { token });
      busy = (Array.isArray(tasks) ? tasks : []).filter((task) => task.State !== "Idle").length;
      const movies = (items?.Items ?? []).filter((item) => item.Type === "Movie" && typeof item.Path === "string");
      listed = SCANNED_SAMPLES.filter((file) => movies.some((item) => item.Path.endsWith(`/${file}`))).length;
      quietPolls = listed === SCANNED_SAMPLES.length && busy === 0 ? quietPolls + 1 : 0;
      if (quietPolls >= 2) {
        log(`tv wire: scanned the ${target} library; ${listed} sample(s) listed, scheduled tasks idle`);
        return;
      }
    }
    throw new Error(
      `${target}'s library scan did not settle in ${SCAN_LIMIT_MS / 1000} s (${listed} of ${SCANNED_SAMPLES.length} samples listed, ${busy} scheduled task(s) busy)`,
    );
  } finally {
    await call("POST", "/Sessions/Logout", { token }).catch(() => {});
  }
}
