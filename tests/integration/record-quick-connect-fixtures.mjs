// Records scrubbed Quick Connect contract fixtures (T4-03 D11) from the two pinned Jellyfin servers: the availability
// check, a code before and after approval, the sign-in, an unknown secret, and the same routes with Quick Connect off.
// Usage: pnpm samples:generate && pnpm fixture:up && pnpm fixture:setup
//        && node tests/integration/record-quick-connect-fixtures.mjs
// The tokenless calls carry the header the app sends before sign-in, with an empty Token. The fixture admin approves the
// code; that call is not recorded. Quick Connect is turned off for the last three answers and the setting is put back,
// also after a failure or a signal. Never run it against a real server. Credentials come from
// tests/integration/.credentials and are never printed.
// In the files the secret is a fixed lowercase fake (Jellyfin's is uppercase) and the code is 482913. Each file is
// { request: { method, path, queryNames }, status, body }. Scrubbing and the leak checks are shared with the other
// recorders (fixture-recording.mjs).
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { call, callStatus, makeSaver, makeScrubber, readCredentials } from "./fixture-recording.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(here, "..", "..", "packages", "core", "tests", "fixtures", "jellyfin");

const servers = [
  { name: "jellyfin-10-11", folder: "10.11.7", fakeServerId: "server-1011" },
  { name: "jellyfin-12", folder: "12.4.0", fakeServerId: "server-124" },
];

// The server binds the secret to this DeviceId, so the code's three calls and the sign-in all send it.
const TOKENLESS_CLIENT = 'MediaBrowser Client="Octave Tests", Device="ci", DeviceId="octave-fixtures-quick-connect", Version="0", Token=""';
const FAKE_SECRET = "0123456789abcdef".repeat(4);
const UNKNOWN_SECRET = "0".repeat(64);
const FAKE_CODE = "482913";
// A documentation address (RFC 5737) in place of the one the server saw the recorder at.
const FAKE_REMOTE_ADDRESS = "192.0.2.1";

const ENABLED = { method: "GET", path: "/QuickConnect/Enabled" };
const INITIATE = { method: "POST", path: "/QuickConnect/Initiate" };
const CONNECT = { method: "GET", path: "/QuickConnect/Connect" };
const AUTHENTICATE = { method: "POST", path: "/Users/AuthenticateWithQuickConnect" };

const credentials = readCredentials();

// What puts the servers back as they were. Run once, newest first.
const cleanups = [];
const failures = [];
async function cleanup() {
  for (let undo = cleanups.pop(); undo !== undefined; undo = cleanups.pop()) {
    try {
      await undo();
    } catch (error) {
      failures.push(`clean-up: ${error instanceof Error ? error.message : "failed"}`);
    }
  }
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    console.error(`${signal}: cleaning up`);
    cleanup().finally(() => process.exit(1));
  });
}

/** Sends a scene's request as the app does. A status other than the expected one stops the run, so it is never saved. */
async function answer(base, request, expected, { query, body } = {}) {
  const { status, data } = await callStatus(base, undefined, request.method, request.path, { query, body, client: TOKENLESS_CLIENT });
  if (status !== expected) throw new Error(`${request.method} ${request.path} -> ${status}, expected ${expected}`);
  return { request: { ...request, queryNames: Object.keys(query ?? {}) }, status, body: data ?? null };
}

function withFakes(value, fakes) {
  const text = [...fakes].reduce((result, [real, fake]) => result.split(real).join(fake), JSON.stringify(value));
  return JSON.parse(text, (key, entry) => (key === "RemoteEndPoint" && typeof entry === "string" ? FAKE_REMOTE_ADDRESS : entry));
}

async function record(server) {
  const base = credentials[`${server.name}_url`];
  const info = await call(base, undefined, "GET", "/System/Info/Public");
  console.log(`${server.name}: Jellyfin ${info.Version}`);
  const admin = await call(base, undefined, "POST", "/Users/AuthenticateByName", {
    body: { Username: credentials[`${server.name}_username`], Pw: credentials[`${server.name}_password`] },
  });
  const tokens = [admin.AccessToken];
  const secrets = [];
  // Real value to fake, for every secret and code a scene's answer can hold.
  const fakes = new Map();
  const scenes = new Map();

  const initiate = async () => {
    const recording = await answer(base, INITIATE, 200);
    const { Secret: secret, Code: code } = recording.body;
    if (!secret || !code) throw new Error(`${server.name}: Initiate gave no secret or code`);
    secrets.push(secret);
    fakes.set(secret, FAKE_SECRET).set(`"${code}"`, `"${FAKE_CODE}"`);
    return { recording, secret, code };
  };

  scenes.set("enabled", await answer(base, ENABLED, 200));
  const { recording, secret, code } = await initiate();
  scenes.set("initiate", recording);
  scenes.set("connect-pending", await answer(base, CONNECT, 200, { query: { secret } }));
  await call(base, admin.AccessToken, "POST", "/QuickConnect/Authorize", { query: { code } });
  scenes.set("connect-approved", await answer(base, CONNECT, 200, { query: { secret } }));
  const signedIn = await answer(base, AUTHENTICATE, 200, { body: { Secret: secret } });
  const { AccessToken: quickConnectToken } = signedIn.body;
  if (!quickConnectToken) throw new Error(`${server.name}: the sign-in gave no token`);
  tokens.push(quickConnectToken);
  cleanups.push(() => call(base, quickConnectToken, "POST", "/Sessions/Logout"));
  scenes.set("authenticate", signedIn);
  scenes.set("connect-unknown", await answer(base, CONNECT, 404, { query: { secret: UNKNOWN_SECRET } }));

  // A code the server holds when Quick Connect is turned off, as when a TV is waiting.
  const held = await initiate();
  const configuration = await call(base, admin.AccessToken, "GET", "/System/Configuration");
  const setAvailable = (available) =>
    call(base, admin.AccessToken, "POST", "/System/Configuration", { body: { ...configuration, QuickConnectAvailable: available } });
  cleanups.push(() => setAvailable(configuration.QuickConnectAvailable));
  await setAvailable(false);
  scenes.set("disabled-enabled", await answer(base, ENABLED, 200));
  scenes.set("disabled-initiate", await answer(base, INITIATE, 401));
  scenes.set("disabled-connect", await answer(base, CONNECT, 401, { query: { secret: held.secret } }));
  await cleanup();

  const outDir = join(fixturesRoot, server.folder);
  mkdirSync(outDir, { recursive: true });
  const save = makeSaver({
    outDir,
    folder: server.folder,
    scrub: makeScrubber({
      tokens,
      host: new URL(base).host,
      fakeUserIds: [{ real: admin.User.Id.toLowerCase(), fake: "user-test" }],
      fakeServerId: { real: String(info.Id).toLowerCase(), fake: server.fakeServerId },
      knownIds: new Map(),
      serverNames: [info.ServerName].filter(Boolean),
    }),
    secrets: [...tokens, ...secrets],
  });
  for (const [scene, recorded] of scenes) save(`quick-connect-${scene}`, withFakes(recorded, fakes));
}

try {
  for (const server of servers) await record(server);
} catch (error) {
  failures.push(`recording: ${error instanceof Error ? error.message : "failed"}`);
} finally {
  await cleanup();
}
if (failures.length) {
  console.error(`failed:\n  ${failures.join("\n  ")}`);
  process.exitCode = 1;
}
