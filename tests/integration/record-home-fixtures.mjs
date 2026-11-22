// Records scrubbed Home contract fixtures (T5-02) from the three fixture servers: the five or six answers that
// Home's four lists get (Resume, Next Up, recently played and the cross-library Latest), plus two Latest variants kept
// as evidence (without includeItemTypes, and with groupItems=false).
// Usage: pnpm samples:generate && pnpm fixture:up && pnpm fixture:setup && node tests/integration/record-home-fixtures.mjs
// Raw requests only (no gateway code), so it runs before the gateway method exists. Each request carries the same
// query the gateway sends (packages/core/src/jellyfin/gateway.ts), written out here.
// Jellyfin: the three home-latest* files are recorded first, on a user with no watch state, so no "hide played in
// Latest" setting can change them. Then the scene runs as the octave-discovery user with fixed dates:
// the H.264 film in progress (1 June 2026), the Multitrack film in progress (2 June), S01E01 finished (3 June), so
// Next Up offers S01E02. The user is reset at the end.
// Jellyscale: a saved position on the H.264 film as octave-test, the five files, then the position is cleared.
// Ids are readable fakes for the known items and numbered fakes for the rest, consistent among the home-* files of one
// folder only (this recorder cannot import record-jellyscale-fixtures.ts, so they differ from latest-*.json).
// Credentials come from tests/integration/.credentials and are never printed.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { call, callStatus, makeSaver, makeScrubber, readCredentials } from "./fixture-recording.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(here, "..", "..", "packages", "core", "tests", "fixtures");

const servers = [
  { name: "jellyfin-10-11", folder: "10.11.7", fakeServerId: "server-1011" },
  { name: "jellyfin-12", folder: "12.4.0", fakeServerId: "server-124" },
];

const RECENT_1 = "2026-06-01T12:00:00Z";
const RECENT_2 = "2026-06-02T12:00:00Z";
const RECENT_3 = "2026-06-03T12:00:00Z";

const itemPaths = [
  ["item-h264", "Synthetic H264 (2024).mkv"],
  ["item-multitrack", "Synthetic Multitrack (2024).mkv"],
  ["item-episode-1", "Synthetic Show S01E01.mkv"],
  ["item-episode-2", "Synthetic Show S01E02.mkv"],
];

const cardImages = { imageTypeLimit: 1, enableImageTypes: "Primary,Backdrop,Thumb,Logo" };
const card = { fields: "PrimaryImageAspectRatio", ...cardImages };

const credentials = readCredentials();

async function login(base, username, password) {
  const auth = await call(base, undefined, "POST", "/Users/AuthenticateByName", { body: { Username: username, Pw: password } });
  return { token: auth.AccessToken, userId: auth.User.Id };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(what, check, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(2000);
  }
}

// ---- Jellyfin 10.11.7 and 12.4.0 --------------------------------------------------------------------------------------
for (const server of servers) {
  const base = credentials[`${server.name}_url`];
  const admin = await login(base, credentials[`${server.name}_username`], credentials[`${server.name}_password`]);
  const me = await login(base, credentials[`${server.name}_discovery_username`], credentials[`${server.name}_discovery_password`]);
  const userId = me.userId;
  const info = await call(base, undefined, "GET", "/System/Info/Public");
  console.log(`${server.name}: Jellyfin ${info.Version}`);

  const asMe = (method, path, opts = {}) => call(base, me.token, method, path, { ...opts, query: { userId, ...(opts.query ?? {}) } });
  const asMeStatus = (method, path, opts = {}) => callStatus(base, me.token, method, path, { ...opts, query: { userId, ...(opts.query ?? {}) } });

  const fakeIds = new Map();
  const nameId = (fake, id) => fakeIds.set(id.toLowerCase(), fake);
  const findSamples = async () => {
    const all = (await asMe("GET", "/Items", { query: { recursive: true, includeItemTypes: "Movie,Series,Episode", fields: "Path" } })).Items ?? [];
    const matched = itemPaths.map(([fake, path]) => [fake, all.find((i) => i.Path?.endsWith(path))]);
    return matched.some(([, item]) => !item) ? undefined : { all, matched };
  };
  // A scan that runs during the scene can rewrite the user data, so the library is refreshed only when it is empty.
  let found = await findSamples();
  if (!found) {
    await call(base, admin.token, "POST", "/Library/Refresh");
    found = await waitFor("the sample items", findSamples);
    await sleep(15000);
  }
  const ids = {};
  for (const [fake, item] of found.matched) {
    ids[fake] = item.Id;
    nameId(fake, item.Id);
  }
  const series = found.all.find((i) => i.Type === "Series" && i.Name === "Synthetic Show");
  nameId("series-synthetic", series.Id);
  const runtime = new Map(found.all.map((i) => [i.Id, i.RunTimeTicks]));
  for (const view of (await asMe("GET", "/UserViews")).Items) {
    if (view.CollectionType === "movies") nameId("view-movies", view.Id);
    if (view.CollectionType === "tvshows") nameId("view-shows", view.Id);
  }

  const outDir = join(fixturesRoot, "jellyfin", server.folder);
  mkdirSync(outDir, { recursive: true });
  const secrets = [admin.token, me.token];
  const scrub = makeScrubber({
    tokens: secrets,
    host: new URL(base).host,
    fakeUserIds: [
      { real: me.userId.toLowerCase(), fake: "user-discovery" },
      { real: admin.userId.toLowerCase(), fake: "user-test" },
    ],
    fakeServerId: { real: info.Id.toLowerCase(), fake: server.fakeServerId },
    knownIds: fakeIds,
    serverNames: [info.ServerName].filter(Boolean),
  });
  const save = makeSaver({ outDir, folder: server.folder, scrub, secrets });

  const resetUser = async () => {
    for (const [fake] of itemPaths) {
      const id = ids[fake];
      await asMeStatus("DELETE", `/UserPlayedItems/${id}`);
      await asMe("POST", `/UserItems/${id}/UserData`, { body: { PlaybackPositionTicks: 0 } });
    }
  };
  const setState = async (fake, { played = false, progress = 0, date }) => {
    const id = ids[fake];
    await asMe("POST", `/UserItems/${id}/UserData`, {
      body: { Played: played, PlayCount: played ? 1 : 0, PlaybackPositionTicks: Math.floor((runtime.get(id) ?? 0) * progress), LastPlayedDate: date },
    });
    const item = await asMe("GET", `/Items/${id}`);
    if (!item.UserData?.LastPlayedDate?.startsWith(date.slice(0, 19))) throw new Error(`${server.folder} ignored LastPlayedDate for ${fake}`);
  };

  // The same query latestItems() will send: no parentId, limit 15, grouped, Movie and Episode, user data, card fields.
  const latestQuery = { limit: 15, groupItems: true, includeItemTypes: "Movie,Episode", enableUserData: true, ...card };
  const withoutTypes = { ...latestQuery };
  delete withoutTypes.includeItemTypes;

  // ---- Latest, recorded on a user with no watch state ----
  await resetUser();
  save("home-latest", await asMe("GET", "/Items/Latest", { query: latestQuery }));
  save("home-latest-no-types", await asMe("GET", "/Items/Latest", { query: withoutTypes }));
  save("home-latest-ungrouped", await asMe("GET", "/Items/Latest", { query: { ...latestQuery, groupItems: false } }));
  // Newest first, checked here and not saved: the same request with DateCreated added to the fields.
  const dated = await asMe("GET", "/Items/Latest", { query: { ...latestQuery, fields: "PrimaryImageAspectRatio,DateCreated" } });
  const created = dated.map((item) => Date.parse(item.DateCreated));
  console.log(`  Latest with DateCreated is newest first: ${created.every((value, index) => index === 0 || created[index - 1] >= value)}`);

  // ---- The scene ----
  await setState("item-h264", { progress: 0.4, date: RECENT_1 });
  await setState("item-multitrack", { progress: 0.4, date: RECENT_2 });
  await setState("item-episode-1", { played: true, date: RECENT_3 });
  const resume = await asMe("GET", "/UserItems/Resume", { query: { mediaTypes: "Video", limit: 16, enableUserData: true, enableTotalRecordCount: false, ...card } });
  if (resume.Items.length !== 2) throw new Error(`${server.folder}: Resume holds ${resume.Items.length} titles, expected the two films of the scene`);
  save("home-resume", resume);
  save("home-nextup", await asMe("GET", "/Shows/NextUp", {
    query: { limit: 16, enableRewatching: false, enableResumable: false, enableTotalRecordCount: false, ...cardImages, fields: "PrimaryImageAspectRatio,DateCreated" },
  }));
  save("home-recently-played", await asMe("GET", "/Items", {
    query: {
      recursive: true,
      includeItemTypes: "Movie,Episode",
      filters: "IsPlayed",
      sortBy: "DatePlayed",
      sortOrder: "Descending",
      limit: 100,
      enableUserData: true,
      enableImages: false,
      enableTotalRecordCount: false,
    },
  }));
  await resetUser();
}

// ---- Jellyscale -------------------------------------------------------------------------------------------------------
{
  const base = credentials.jellyscale_url;
  const auth = await call(base, undefined, "POST", "/Users/AuthenticateByName", { body: { Username: credentials.jellyscale_username, Pw: credentials.jellyscale_password } });
  const token = auth.AccessToken;
  const userId = auth.User.Id;
  const info = await call(base, undefined, "GET", "/System/Info/Public");
  const asMe = (method, path, opts = {}) => callStatus(base, token, method, path, { ...opts, query: { userId, ...(opts.query ?? {}) } });
  console.log(`jellyscale: ${info.Version ?? "unknown version"}`);

  const items = ((await asMe("GET", "/Items", { query: { Recursive: true, IncludeItemTypes: "Movie,Series,Episode" } })).data?.Items) ?? [];
  const h264 = items.find((i) => i.Type === "Movie" && i.Name === "Synthetic H264");
  const multitrack = items.find((i) => i.Type === "Movie" && i.Name === "Synthetic Multitrack");
  if (!h264 || !multitrack) throw new Error("Jellyscale lists no Synthetic H264 or Synthetic Multitrack; run pnpm fixture:setup");
  const views = ((await asMe("GET", "/UserViews")).data?.Items) ?? [];
  const known = new Map([
    [h264.Id.toLowerCase(), "item-h264"],
    [multitrack.Id.toLowerCase(), "item-multitrack"],
  ]);
  for (const view of views) {
    if (view.Name === "Movies") known.set(view.Id.toLowerCase(), "view-movies");
    if (view.Name === "Shows") known.set(view.Id.toLowerCase(), "view-shows");
  }

  const outDir = join(fixturesRoot, "jellyscale", "b920b193cd6f");
  mkdirSync(outDir, { recursive: true });
  const compose = readFileSync(join(here, "docker-compose.yml"), "utf8");
  const sha = /^x-jellyscale-commit:\s*([0-9a-f]{40})\b/m.exec(compose)?.[1];
  if (sha?.slice(0, 12) !== "b920b193cd6f") throw new Error("the pinned Jellyscale is not b920b193cd6f; the folder name is stale");
  const secrets = [token];
  const scrub = makeScrubber({
    tokens: secrets,
    host: new URL(base).host,
    fakeUserIds: [{ real: String(userId).toLowerCase(), fake: "user-test" }],
    fakeServerId: { real: String(info.Id).toLowerCase(), fake: "server-jellyscale" },
    knownIds: known,
    serverNames: [info.ServerName ?? "Octave fixture"],
  });
  const save = makeSaver({ outDir, folder: "b920b193cd6f", scrub, secrets });
  // A non-2xx answer is saved as { httpStatus }, as the discovery recorder does; an empty 200 body is saved as null.
  const saveAnswer = (file, { status, data }) => save(file, status >= 200 && status < 300 ? (data ?? null) : { httpStatus: status });
  const record = async (file, path, query) => {
    const answer = await asMe("GET", path, { query });
    console.log(`  ${file}: HTTP ${answer.status}, ${Array.isArray(answer.data) ? `array of ${answer.data.length}` : answer.data === undefined ? "no body" : typeof answer.data}`);
    saveAnswer(file, answer);
  };

  const latestQuery = { limit: 15, groupItems: true, includeItemTypes: "Movie,Episode", enableUserData: true, ...card };
  const withoutTypes = { ...latestQuery };
  delete withoutTypes.includeItemTypes;
  try {
    await asMe("POST", `/UserItems/${h264.Id}/UserData`, { body: { PlaybackPositionTicks: 30000000 } });
    await record("home-latest", "/Items/Latest", latestQuery);
    await record("home-latest-no-types", "/Items/Latest", withoutTypes);
    await record("home-resume", "/UserItems/Resume", { mediaTypes: "Video", limit: 16, enableUserData: true, enableTotalRecordCount: false, ...card });
    await record("home-nextup", "/Shows/NextUp", {
      limit: 16, enableRewatching: false, enableResumable: false, enableTotalRecordCount: false, ...cardImages, fields: "PrimaryImageAspectRatio,DateCreated",
    });
    await record("home-recently-played", "/Items", {
      recursive: true, includeItemTypes: "Movie,Episode", filters: "IsPlayed", sortBy: "DatePlayed", sortOrder: "Descending", limit: 100, enableUserData: true, enableImages: false, enableTotalRecordCount: false,
    });
  } finally {
    await asMe("POST", `/UserItems/${h264.Id}/UserData`, { body: { PlaybackPositionTicks: 0, Played: false } });
  }
}
