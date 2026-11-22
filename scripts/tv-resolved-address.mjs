// T3-20's device half of item 4, run by pnpm tv:e2e after the cleartext probe: start a plain-HTTP server on the host's
// 127.0.0.1, which the emulator reaches through 10.0.2.2, run the module's CleartextProbe with -e check
// resolved-address, and judge its report and the server's record with judgeResolvedAddress(). The probe puts a fixed
// answer table behind the one client's resolved-address rule (its test-only seam) and sends through the one client:
// a name that answers 10.0.2.2 and one that answers a public and a private address must reach the server, one that
// answers only a public address must be refused resolved-public before a connection, a lookup inside a plain-HTTP call
// is judged and one inside an HTTPS call is not (docs/specs/T3-20.md, "The emulator check").
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openAdb } from "./tv-adb.mjs";
import { PROBE_COMPONENT, PROBE_PACKAGE, lastLine, parseInstrumentation, startHostServer } from "./tv-cleartext.mjs";

export const RESOLVED_REPORT_KEYS = [
  "resolved-private",
  "resolved-mixed",
  "resolved-public",
  "resolved-asked",
  "http-outside",
  "https-call",
  "https-asked",
  "https-outside",
  "done",
];
export const RESOLVED_PRIVATE_PATH = "/octave-probe/resolved-private";
export const RESOLVED_MIXED_PATH = "/octave-probe/resolved-mixed";
export const RESOLVED_PUBLIC_PATH = "/octave-probe/resolved-public";
const PRIVATE_NAME = "octave-probe-private.home.arpa";
const MIXED_NAME = "octave-probe-mixed.home.arpa";
const REFUSED = "refused-resolved-public";
const PROBE_MS = 90_000;

// Returns `ERROR tv e2e: resolved-address ...` lines; empty only for a finished report with every key, the private and
// mixed cases at 200, the public case refused resolved-public, all three names asked (so no case rode a pooled
// connection), the plain-HTTP re-entry refused and the HTTPS re-entry unjudged, an HTTPS call that failed (not refused)
// after its name was asked, exactly one request each for the private and mixed paths with the canary header on their
// own Host, and no other request.
export function judgeResolvedAddress(report, served, expected) {
  const errors = [];
  const fail = (reason) => errors.push(`ERROR tv e2e: resolved-address ${reason}`);
  for (const key of RESOLVED_REPORT_KEYS) if (report[key] === undefined) fail(`the probe's report has no ${key}`);
  const has = (key) => report[key] !== undefined;

  if (has("done") && report.done !== "yes") fail(`the probe did not finish (done=${report.done})`);
  for (const key of ["resolved-private", "resolved-mixed"]) {
    if (has(key) && report[key] !== "200") fail(`${key}=${report[key]}; a plain-HTTP name with a private answer must answer 200`);
  }
  if (has("resolved-public") && report["resolved-public"] !== REFUSED) {
    fail(`resolved-public=${report["resolved-public"]}; a plain-HTTP name with only a public answer must be ${REFUSED}`);
  }
  if (has("resolved-asked") && report["resolved-asked"] !== "3") {
    fail(`resolved-asked=${report["resolved-asked"]}; the resolver must be asked for each of the three names`);
  }
  if (has("http-outside") && report["http-outside"] !== REFUSED) {
    fail(`http-outside=${report["http-outside"]}; a lookup inside a plain-HTTP call must be judged and refused`);
  }
  if (has("https-call") && !report["https-call"].startsWith("failed-")) {
    fail(`https-call=${report["https-call"]}; the HTTPS call to the plain server must fail at TLS, not be refused or answer`);
  }
  if (has("https-asked") && report["https-asked"] !== "yes") fail(`https-asked=${report["https-asked"]}; the HTTPS call's name was never resolved`);
  if (has("https-outside") && report["https-outside"] !== "unjudged") {
    fail(`https-outside=${report["https-outside"]}; a lookup inside an HTTPS call must come back unjudged`);
  }

  const routes = [
    ["private", RESOLVED_PRIVATE_PATH, `${PRIVATE_NAME}:${expected.port}`],
    ["mixed", RESOLVED_MIXED_PATH, `${MIXED_NAME}:${expected.port}`],
  ];
  for (const [what, path, host] of routes) {
    const seen = served.filter((record) => record.path === path);
    if (seen.length !== 1) {
      fail(`the server saw ${seen.length} ${what} requests (${path}); expected one`);
      continue;
    }
    if (!seen[0].header) fail(`the server saw the ${what} request without the session's header`);
    if (seen[0].host !== host) fail(`the ${what} request arrived with host ${seen[0].host}, not ${host}`);
  }
  const publicSeen = served.filter((record) => record.path === RESOLVED_PUBLIC_PATH);
  if (publicSeen.length > 0) fail(`the server saw ${publicSeen.length} public request(s) (${RESOLVED_PUBLIC_PATH}); the public case must be refused before a connection`);
  const known = new Set([RESOLVED_PRIVATE_PATH, RESOLVED_MIXED_PATH, RESOLVED_PUBLIC_PATH]);
  const others = served.filter((record) => !known.has(record.path));
  if (others.length > 0) fail(`the server saw ${others.length} request(s) other than the private and mixed ones`);
  return errors;
}

// Installs and runs the probe's resolved-address check on the device `serial` names, judges it, and writes
// release-evidence/tv/e2e-resolved-address.txt. Returns { errors, report, served }. The probe package and the server
// are removed whatever happens. No adb reverse: every connection of the check goes to 10.0.2.2.
export async function runResolvedAddressProbe({ adbPath, serial, apk, evidenceDir }) {
  const { server, served, port } = await startHostServer();
  // Its output holds no serial (T3-30).
  const runner = openAdb({ adbPath, serial });
  const adb = (args, timeoutMs = 60_000) => runner.runAsync(args, { timeoutMs });
  const errors = [];
  let report = {};
  try {
    const install = await adb(["install", "-r", "-t", apk]);
    if (install.code !== 0) errors.push(`ERROR tv e2e: resolved-address probe install failed: ${lastLine(install)}`);
    if (install.code === 0) {
      const run = await adb(
        ["shell", "am", "instrument", "-w", "-e", "check", "resolved-address", "-e", "hostPort", String(port), PROBE_COMPONENT],
        PROBE_MS,
      );
      if (run.killed) errors.push(`ERROR tv e2e: resolved-address probe did not finish within ${PROBE_MS / 1000} s`);
      report = parseInstrumentation(run.stdout);
    }
  } finally {
    await adb(["uninstall", PROBE_PACKAGE]);
    await new Promise((resolve) => server.close(resolve));
  }

  mkdirSync(evidenceDir, { recursive: true });
  const lines = [
    ...RESOLVED_REPORT_KEYS.filter((key) => report[key] !== undefined).map((key) => `${key}=${report[key]}`),
    ...served.map((record) => `served ${record.path} header=${record.header ? "yes" : "no"}`),
  ];
  writeFileSync(join(evidenceDir, "e2e-resolved-address.txt"), `${lines.join("\n")}\n`);
  errors.push(...judgeResolvedAddress(report, served, { port }));
  return { errors, report, served };
}
