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
export const READS_JELLYFIN_LIBRARY = ["player-capabilities", "artwork-header-and-cache", "sign-in-quick-connect"];
// The tests that wait for a card's artwork, so their scan waits for an item with a Primary image.
const NEEDS_A_PICTURE = ["artwork-header-and-cache", "sign-in-quick-connect"];
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
    // T3-11: such a test also needs a card with a Primary image, so the scan waits for one.
    const pictured = pairs.some((pair) => NEEDS_A_PICTURE.includes(pair.test) && pair.target === target);
    await scanOne(target, { credentials, secrets, fetch, sleep, now, log, pictured });
  }
}

// Signs in to the target's fixture origin with its admin user and runs `work(call, token)`, signing out after. The token
// is added to `secrets` before it is used. Messages start with `failed` and hold no query.
async function asFixtureAdmin(target, failed, { credentials, secrets, fetch }, work) {
  const origin = credentials[`${target}_url`];
  const user = credentials[`${target}_username`];
  const password = credentials[`${target}_password`];
  if (!origin || !user || !password) throw new Error(`no fixture credentials for ${target}; run pnpm fixture:setup`);
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
    if (response.status < 200 || response.status > 299) throw new Error(`${failed}: ${method} ${path.split("?")[0]} answered ${response.status}`);
    return response.status === 204 ? null : response.json();
  };

  const signedIn = await call("POST", "/Users/AuthenticateByName", { body: { Username: user, Pw: password } });
  const token = signedIn?.AccessToken;
  if (typeof token !== "string" || token === "") throw new Error(`${failed}: sign-in returned no token`);
  secrets.add(token);
  try {
    await work(call, token);
  } finally {
    await call("POST", "/Sessions/Logout", { token }).catch(() => {});
  }
}

async function scanOne(target, { credentials, secrets, fetch, sleep, now, log, pictured }) {
  await asFixtureAdmin(target, `${target}'s library scan failed`, { credentials, secrets, fetch }, async (call, token) => {
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
      const hasPicture = !pictured || movies.some((item) => typeof item.ImageTags?.Primary === "string" && item.ImageTags.Primary !== "");
      quietPolls = listed === SCANNED_SAMPLES.length && busy === 0 && hasPicture ? quietPolls + 1 : 0;
      if (quietPolls >= 2) {
        log(`tv wire: scanned the ${target} library; ${listed} sample(s) listed, scheduled tasks idle`);
        return;
      }
    }
    throw new Error(
      `${target}'s library scan did not settle in ${SCAN_LIMIT_MS / 1000} s (${listed} of ${SCANNED_SAMPLES.length} samples listed, ${busy} scheduled task(s) busy)`,
    );
  });
}

// T4-03 D12: the runner is the phone. The app writes `OCTAVE_WIRE approve <code>`, and the runner approves that code as
// the fixture's admin. The line holds the code only. The app runs the pairs in list order and writes one result line for
// each, so the code is for the first selected pair of the test that has none yet.
const QUICK_CONNECT_TEST = "sign-in-quick-connect";
const APPROVE_LINE = /^OCTAVE_WIRE approve (\S+)$/;
const PAIR_END_LINE = new RegExp(`^OCTAVE_WIRE (?:result|unreachable) test=${QUICK_CONNECT_TEST} target=(\\S+)`);
const CODE = /^[0-9]{6}$/;

export function openQuickConnectApprover({ pairs, credentials, secrets, fetch = globalThis.fetch }) {
  const waiting = pairs.filter((pair) => pair.test === QUICK_CONNECT_TEST).map((pair) => pair.target);
  const approved = [];
  const errors = [];

  const approve = async (code) => {
    const [target] = waiting;
    if (target === undefined || !CODE.test(code)) {
      errors.push("ERROR tv wire approve: the app asked for an approval no selected pair waits for, or with a code that is not six digits");
      return;
    }
    try {
      await asFixtureAdmin(target, `${target}'s approval failed`, { credentials, secrets, fetch }, (call, token) =>
        call("POST", `/QuickConnect/Authorize?code=${code}`, { token }),
      );
      approved.push(target);
    } catch (error) {
      errors.push(`ERROR tv wire approve: ${error.message}`);
    }
  };

  return {
    errors,
    // Takes the app's next OCTAVE_WIRE lines, in order, each once.
    async answer(lines) {
      for (const line of lines) {
        const ended = PAIR_END_LINE.exec(line);
        if (ended !== null && waiting.includes(ended[1])) waiting.splice(waiting.indexOf(ended[1]), 1);
        const asked = APPROVE_LINE.exec(line);
        if (asked !== null) await approve(asked[1]);
      }
    },
    // The device.txt line that says what the runner approved.
    describe() {
      return [`quick connect codes approved: ${approved.length === 0 ? "none" : approved.join(" ")}`];
    },
  };
}
