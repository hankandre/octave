// T3-15's device half of item 2, run by pnpm tv:e2e: start a plain-HTTP server on the host's 127.0.0.1, let the
// emulator reach it through 10.0.2.2 (private LAN) and through adb reverse (loopback), run the module's CleartextProbe
// in its test APK, and judge the probe's report and the server's record with judgeCleartext(). The probe sends through
// the one OkHttp client under the network security configuration modules/session declares, and opens a session for
// every public vector of host-classes.json, each refused before a request exists (docs/specs/T3-15.md).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openAdb } from "./tv-adb.mjs";

const HOST_CLASSES = fileURLToPath(new URL("../packages/core/tests/fixtures/host-classes.json", import.meta.url));

export const PROBE_PACKAGE = "dev.octave.session.test";
export const PROBE_COMPONENT = `${PROBE_PACKAGE}/dev.octave.session.devicecheck.CleartextProbe`;
export const PRIVATE_LAN_PATH = "/octave-probe/private-lan";
export const LOOPBACK_PATH = "/octave-probe/loopback";
// The made-up header the probe sends, as MediaBrowserHeader.build writes it for CleartextProbe's canary fields. No
// real token, device or name.
export const CANARY_HEADER =
  'MediaBrowser Client="OctaveProbe", Device="Emulator", DeviceId="cleartext-probe", Version="0.0.0", Token="canary0123456789"';
export const REPORT_KEYS = ["policy", "target-sdk", "private-lan", "loopback", "public-total", "public-refused", "public-other", "https-open", "done"];
const MIN_TARGET_SDK = 28;
const PROBE_MS = 60_000;

// How many vectors of the shared host-class file are public.
export function expectedPublicCount() {
  const hosts = JSON.parse(readFileSync(HOST_CLASSES, "utf8"));
  return hosts.vectors.filter((vector) => vector.class === "public").length;
}

// `am instrument -w` output as the report object. Fails closed: output with INSTRUMENTATION_FAILED, or without the
// result code RESULT_OK (-1), gives a report without `done`.
export function parseInstrumentation(text) {
  const report = {};
  let code;
  let failed = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const result = /^INSTRUMENTATION_RESULT: ([a-z-]+)=(\S*)$/.exec(line);
    if (result !== null) report[result[1]] = result[2];
    const exit = /^INSTRUMENTATION_CODE: (-?\d+)$/.exec(line);
    if (exit !== null) code = Number(exit[1]);
    if (line.startsWith("INSTRUMENTATION_FAILED") || line.startsWith("INSTRUMENTATION_ABORTED")) failed = true;
  }
  if (failed || code !== -1) delete report.done;
  return report;
}

const isCount = (value) => typeof value === "string" && /^\d+$/.test(value);

// Returns `ERROR tv e2e: cleartext ...` lines; empty only for a finished probe under a policy that permits cleartext,
// a test APK that targets API 28 or higher, one 200 from each of the private-LAN and loopback requests, each seen once
// by the server with the canary header on the expected Host, every public vector refused with public-http, an https
// session that opens, and no other request at the server.
export function judgeCleartext(report, served, expected) {
  const errors = [];
  const fail = (reason) => errors.push(`ERROR tv e2e: cleartext ${reason}`);
  for (const key of REPORT_KEYS) if (report[key] === undefined) fail(`the probe's report has no ${key}`);

  if (report.done !== undefined && report.done !== "yes") fail(`the probe did not finish (done=${report.done})`);
  if (report.policy !== undefined && report.policy !== "permitted") fail(`policy=${report.policy}; Android does not permit cleartext in the probe's process`);
  const target = report["target-sdk"];
  if (target !== undefined && (!isCount(target) || Number(target) < MIN_TARGET_SDK)) {
    fail(`target-sdk=${target}; the test APK must target API ${MIN_TARGET_SDK} or higher, where Android refuses cleartext by default`);
  }
  for (const key of ["private-lan", "loopback"]) {
    if (report[key] !== undefined && report[key] !== "200") fail(`${key}=${report[key]}; the plain-HTTP request must answer 200`);
  }

  const total = report["public-total"];
  const refused = report["public-refused"];
  const other = report["public-other"];
  if (total !== undefined) {
    if (!isCount(total)) fail(`public-total=${total} is not a count`);
    else if (Number(total) !== expected.publicTotal) fail(`public-total=${total}, but host-classes.json holds ${expected.publicTotal} public vectors`);
  }
  if (refused !== undefined) {
    if (!isCount(refused)) fail(`public-refused=${refused} is not a count`);
    else if (Number(refused) !== expected.publicTotal) fail(`public-refused=${refused} of ${expected.publicTotal} public vectors`);
  }
  if (other !== undefined && other !== "0") fail(`public-other=${other}; every public vector must be refused with public-http`);
  if (report["https-open"] !== undefined && report["https-open"] !== "ok") fail(`https-open=${report["https-open"]}; an https session did not open`);

  const routes = [
    ["private-lan", PRIVATE_LAN_PATH, `10.0.2.2:${expected.port}`],
    ["loopback", LOOPBACK_PATH, `127.0.0.1:${expected.port}`],
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
  const others = served.filter((record) => !routes.some(([, path]) => record.path === path));
  if (others.length > 0) fail(`the server saw ${others.length} request(s) other than the private-lan and loopback ones`);
  return errors;
}

// The host's test server on 127.0.0.1. It records each request's path, Host, and whether Authorization equals the
// canary, and answers 200 with a fixed body. Shared with scripts/tv-resolved-address.mjs (T3-20).
export function startHostServer() {
  const served = [];
  const server = createServer((request, response) => {
    served.push({ path: request.url ?? "", host: request.headers.host ?? "", header: request.headers.authorization === CANARY_HEADER });
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("octave probe\n");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ server, served, port: server.address().port }));
  });
}

export const lastLine = (result) => (result.stdout + result.stderr).trim().split("\n").pop() ?? "";

// Installs and runs the probe on the device `serial` names, judges it, and writes release-evidence/tv/e2e-cleartext.txt.
// Returns { errors, report, served }. The reverse rule, the probe package and the server are removed whatever happens.
export async function runCleartextProbe({ adbPath, serial, apk, evidenceDir }) {
  const { server, served, port } = await startHostServer();
  // Runs adb asynchronously, so the host server keeps answering while the probe runs; its output holds no serial (T3-30).
  const runner = openAdb({ adbPath, serial });
  const adb = (args, timeoutMs = PROBE_MS) => runner.runAsync(args, { timeoutMs });
  const errors = [];
  let report = {};
  try {
    const reverse = await adb(["reverse", `tcp:${port}`, `tcp:${port}`]);
    if (reverse.code !== 0) errors.push(`ERROR tv e2e: cleartext adb reverse failed: ${lastLine(reverse)}`);
    const install = reverse.code === 0 ? await adb(["install", "-r", "-t", apk]) : undefined;
    if (install !== undefined && install.code !== 0) errors.push(`ERROR tv e2e: cleartext probe install failed: ${lastLine(install)}`);
    if (install?.code === 0) {
      const run = await adb(["shell", "am", "instrument", "-w", "-e", "hostPort", String(port), PROBE_COMPONENT]);
      if (run.killed) errors.push(`ERROR tv e2e: cleartext probe did not finish within ${PROBE_MS / 1000} s`);
      report = parseInstrumentation(run.stdout);
    }
  } finally {
    await adb(["reverse", "--remove", `tcp:${port}`]);
    await adb(["uninstall", PROBE_PACKAGE]);
    await new Promise((resolve) => server.close(resolve));
  }

  mkdirSync(evidenceDir, { recursive: true });
  const lines = [
    ...REPORT_KEYS.filter((key) => report[key] !== undefined).map((key) => `${key}=${report[key]}`),
    ...served.map((record) => `served ${record.path} header=${record.header ? "yes" : "no"}`),
  ];
  writeFileSync(join(evidenceDir, "e2e-cleartext.txt"), `${lines.join("\n")}\n`);
  errors.push(...judgeCleartext(report, served, { publicTotal: expectedPublicCount(), port }));
  return { errors, report, served };
}
