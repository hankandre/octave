// Records scrubbed display-preferences contract fixtures (T9-09) from the three fixture servers.
// Usage: pnpm samples:generate && pnpm fixture:up && pnpm fixture:setup
//        && node tests/integration/record-display-preferences-fixtures.mjs
// The scene is in docs/specs/T9-09.md "Recorded answers": device A and device B are two sign-ins of one
// non-admin user with different DeviceIds. On Jellyfin the user is a throwaway (octave-prefs), deleted at the
// end; Jellyscale has no user API, so it uses octave-test and posts an empty record at the end. The recorder
// refuses to start when the account's `octave` record already holds an octave. key (run pnpm fixture:down).
// Never run it against a real server. Credentials come from tests/integration/.credentials, never printed.
// Scrubbing and the leak checks are shared with the other recorders (fixture-recording.mjs).
import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { call, callStatus, CLIENT_B, makeSaver, makeScrubber, readCredentials } from "./fixture-recording.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(here, "..", "..", "packages", "core", "tests", "fixtures");
const THROWAWAY = "octave-prefs";
const RECORD = { id: "octave", client: "octave" };
const OTHER_APP = { id: "usersettings", client: "emby" };

const servers = [
  { name: "jellyfin-10-11", dir: join("jellyfin", "10.11.7"), fakeServerId: "server-1011", throwaway: true },
  { name: "jellyfin-12", dir: join("jellyfin", "12.4.0"), fakeServerId: "server-124", throwaway: true },
  { name: "jellyscale", dir: join("jellyscale", "b920b193cd6f"), fakeServerId: "server-jellyscale", throwaway: false },
];

// D4's body, in R1's order: the constant fields, then CustomPrefs with the kept keys first and D2's five keys after.
function bodyFor(values, kept) {
  return {
    Id: RECORD.id,
    Client: RECORD.client,
    SortBy: "SortName",
    SortOrder: "Ascending",
    RememberIndexing: false,
    RememberSorting: false,
    ScrollDirection: "Horizontal",
    ShowBackdrop: true,
    ShowSidebar: false,
    PrimaryImageHeight: 250,
    PrimaryImageWidth: 250,
    CustomPrefs: {
      ...kept,
      "octave.continueWindow": values.continueWindow,
      "octave.autoPlay": values.autoPlay,
      "octave.autoPlayCountdown": values.autoPlayCountdown,
      "octave.skipIntro": values.skipIntro,
      "octave.skipCredits": values.skipCredits,
    },
  };
}
const FIVE = ["continueWindow", "autoPlay", "autoPlayCountdown", "skipIntro", "skipCredits"];
const valuesOf = (answer) => Object.fromEntries(FIVE.map((name) => [name, answer?.CustomPrefs?.[`octave.${name}`]]));
const keptOf = (answer) =>
  Object.fromEntries(Object.entries(answer?.CustomPrefs ?? {}).filter(([key]) => key.startsWith("octave.") && !FIVE.includes(key.slice(7))));

const credentials = readCredentials();
const failures = [];
const cleanups = [];
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const fn of cleanups) {
    try {
      await fn();
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

async function login(base, username, password, client) {
  const auth = await call(base, undefined, "POST", "/Users/AuthenticateByName", { body: { Username: username, Pw: password }, client });
  return { token: auth.AccessToken, userId: auth.User.Id };
}

async function record(server) {
  const base = credentials[`${server.name}_url`];
  const info = await call(base, undefined, "GET", "/System/Info/Public");
  console.log(`${server.name}: ${info.Version ?? "unknown version"}`);
  const admin = await login(base, credentials[`${server.name}_username`], credentials[`${server.name}_password`]);
  const secrets = [admin.token];
  let a;
  let b;
  const fakeUserIds = [{ real: admin.userId.toLowerCase(), fake: "user-test" }];
  let userId;
  if (server.throwaway) {
    for (const user of (await call(base, admin.token, "GET", "/Users")).filter((u) => u.Name === THROWAWAY)) {
      await call(base, admin.token, "DELETE", `/Users/${user.Id}`);
    }
    const password = randomBytes(24).toString("base64url");
    await call(base, admin.token, "POST", "/Users/New", { body: { Name: THROWAWAY, Password: password } });
    a = await login(base, THROWAWAY, password);
    b = await login(base, THROWAWAY, password, CLIENT_B);
    userId = a.userId;
    fakeUserIds.push({ real: userId.toLowerCase(), fake: "user-prefs" });
    cleanups.push(async () => {
      for (const user of (await call(base, admin.token, "GET", "/Users")).filter((u) => u.Name === THROWAWAY)) {
        await call(base, admin.token, "DELETE", `/Users/${user.Id}`);
      }
    });
  } else {
    a = admin;
    b = await login(base, credentials[`${server.name}_username`], credentials[`${server.name}_password`], CLIENT_B);
    userId = a.userId;
  }
  secrets.push(a.token, b.token);

  const outDir = join(fixturesRoot, server.dir);
  mkdirSync(outDir, { recursive: true });
  const folder = server.dir.split(/[\\/]/).at(-1);
  const save = makeSaver({
    outDir,
    folder,
    scrub: makeScrubber({
      tokens: secrets,
      host: new URL(base).host,
      fakeUserIds,
      fakeServerId: { real: String(info.Id).toLowerCase(), fake: server.fakeServerId },
      knownIds: new Map(),
      serverNames: [info.ServerName].filter(Boolean),
    }),
    secrets,
  });

  const steps = [];
  const step = async (label, who, method, record, body) => {
    const query = { userId, client: record.client };
    const answer = await callStatus(base, who.token, method, `/DisplayPreferences/${record.id}`, {
      query,
      body,
      client: who === b ? CLIENT_B : undefined,
    });
    steps.push({
      step: label,
      device: who === b ? "B" : "A",
      request: { method, path: `/DisplayPreferences/${record.id}`, query, ...(body === undefined ? {} : { body }) },
      status: answer.status,
      body: answer.data ?? null,
    });
    console.log(`  ${label}: ${method} ${record.id} -> ${answer.status}`);
    return answer;
  };

  if (!server.throwaway) {
    cleanups.push(async () => {
      await callStatus(base, a.token, "POST", `/DisplayPreferences/${RECORD.id}`, {
        query: { userId, client: RECORD.client },
        body: { ...bodyFor({}, {}), CustomPrefs: {} },
      });
    });
  }

  const s0 = await step("S0", a, "GET", OTHER_APP);
  const s1 = await step("S1", a, "GET", RECORD);
  if (Object.keys(s1.data?.CustomPrefs ?? {}).some((key) => key.startsWith("octave."))) {
    throw new Error(`${server.name}: the octave record already holds an octave. key; run pnpm fixture:down first`);
  }
  const written = { continueWindow: "180", autoPlay: "false", autoPlayCountdown: "15", skipIntro: "auto", skipCredits: "none" };
  await step("S2", a, "POST", RECORD, bodyFor(written, { "octave.futureSetting": "on" }));
  const s3 = await step("S3", a, "GET", RECORD);
  const s4 = await step("S4", b, "GET", RECORD);
  await step("S5", b, "POST", RECORD, bodyFor({ ...valuesOf(s4.data), continueWindow: "30" }, keptOf(s4.data)));
  const s6 = await step("S6", a, "GET", RECORD);
  const s7 = await step("S7", a, "GET", OTHER_APP);

  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const stepsOk = steps.every((s) => s.status >= 200 && s.status < 300);
  console.log(
    `  S3=S2 ${same(valuesOf(s3.data), written)} S4=S3 ${same(valuesOf(s4.data), valuesOf(s3.data))} ` +
      `S6=S5 ${valuesOf(s6.data).continueWindow === "30"} S7=S0 ${same(s7.data, s0.data)} all 2xx ${stepsOk}`,
  );
  save("display-preferences", { server: server.name, steps });
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
