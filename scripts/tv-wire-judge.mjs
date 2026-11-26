// The host judges of pnpm tv:wire (T3-05; docs/specs/T3-05.md, "The wire runner"). Each returns `ERROR ...` lines,
// empty for a pass, and never quotes a secret, a header value, a query value or a body.
//
// - judgeCapture(records, { expected, host, secrets }): one pair's recorded requests against the requests its test
//   sends (item 3).
// - judgeRecords(records, { host, secrets, redirects }): the rules every pair's requests keep: the MediaBrowser header,
//   a token only off the six tokenless calls, no credential query name, no secret in the URL, the recorder's Host, and
//   no 3xx relayed (unless the pair's upstream is the redirector).
// - judgeLogcat(lines, secrets): the whole logcat dump of the run (item 4).
// - judgePlayerCapture(records): a play's media requests (T8-02 item 7): only original-file stream URLs, a range request
//   among them, and no playlist, universal, subtitle or trickplay path.
// - judgeCapabilityCapture(records): the PlaybackInfo requests of player-capabilities (T8-07 items 4, 6 and 7): one for
//   the H.264 item, then the no-decoder item's first and forced requests, the forced flags in body and query, and the
//   one Octave profile on each.
// - judgeArtworkCapture(records, { host, secrets, images, widths }): the artwork test's capture (T3-11 items 2 to 4):
//   the four non-image calls in order, exactly `images` Primary image requests with distinct paths between the latest
//   items and the logout, and on the mock every maxWidth 248.
// - judgeViewingCapture(records, words): player-viewing's playstate reports and result words (T8-03 items 2, 4, 7 and
//   8): two viewings, each a start, progress and one stop in order, with fresh positions, a pause, a stop that did not
//   fail, the second start where the first stopped, and only original-file media requests.
// - judgeTransportCapture(records, tokens, { keys, windows }): player-transport's playstate reports, its result words,
//   the keys the runner sent and its reads of the window (T8-04, D13): an arrow that wakes the controls seeks nothing,
//   two seeks forward and one back while paused, every pause and resume from the keys that make one, a stop by Back
//   before the file's end, original-file media requests only, and the screen kept on only while playing.
// - judgeWire({ pairs, lines }): the app's OCTAVE_WIRE lines against the selected pairs and the host's counts
//   (items 2, 4, 6 and 9); WIRE_JUDGES holds the rule per test id.
import { findSecret } from "../apps/tv/src/e2e/wire/find-secret.ts";

// Decision 0005: the four PRE_SIGN_IN_ROUTES and the two sign-in posts carry the header with an empty token.
export const TOKENLESS_CALLS = [
  "GET /System/Info/Public",
  "GET /QuickConnect/Enabled",
  "POST /QuickConnect/Initiate",
  "GET /QuickConnect/Connect",
  "POST /Users/AuthenticateByName",
  "POST /Users/AuthenticateWithQuickConnect",
];

// packages/core/src/jellyfin/credential-query.ts, compared trimmed and lower-cased.
const CREDENTIAL_NAMES = new Set(["apikey", "api_key", "access_token", "token", "x-emby-token", "apitoken", "accesstoken"]);

// The fewest seam crossings transport-canary's six calls and its probe make (two per call).
export const MIN_CANARY_CROSSINGS = 12;

const call = (record) => `${record.method} ${record.path}`;

function decodeRounds(text, rounds = 4) {
  const out = [text];
  let current = text;
  for (let round = 0; round < rounds; round += 1) {
    try {
      current = decodeURIComponent(current);
    } catch {
      break;
    }
    out.push(current);
  }
  return out;
}

// A method and path for a message, or a stand-in when the path holds a secret, so no message quotes one.
export const holdsSecret = (text, secrets) => decodeRounds(text).some((decoded) => findSecret(decoded, secrets));
const shown = (text, secrets) => (holdsSecret(text, secrets) ? "a request whose path holds a secret" : text);

// The rules every recorded request keeps. Messages name the request by method and path, never by its values.
export function judgeRecords(records, { host, secrets, redirects = false }) {
  const errors = [];
  records.forEach((record, index) => {
    const name = `request ${index + 1} (${shown(call(record), secrets)})`;
    if (!record.authorization) errors.push(`ERROR wire capture: ${name} has no Authorization header`);
    else if (record.scheme !== "MediaBrowser") errors.push(`ERROR wire capture: ${name} uses an Authorization scheme other than MediaBrowser`);
    const tokenless = TOKENLESS_CALLS.includes(call(record));
    if (record.authorization && tokenless && record.token) errors.push(`ERROR wire capture: ${name} carries a token on a tokenless call`);
    if (record.authorization && !tokenless && !record.token) errors.push(`ERROR wire capture: ${name} carries no token on a signed-in call`);
    const names = record.queryNames ?? [];
    if (names.some((queryName) => decodeRounds(queryName).some((text) => CREDENTIAL_NAMES.has(text.trim().toLowerCase())))) {
      errors.push(`ERROR wire capture: ${name} has a credential query name`);
    }
    if (record.secretInUrl || [record.path, ...names].some((text) => holdsSecret(text, secrets))) {
      errors.push(`ERROR wire capture: ${name} holds a known secret in its URL`);
    }
    if (record.host !== host) errors.push(`ERROR wire capture: ${name} has a Host that is not the recorder's`);
    if (!redirects && record.status !== null && record.status >= 300 && record.status < 400) {
      errors.push(`ERROR wire capture: ${name} was answered with a redirect (${record.status}) that reached the app`);
    }
  });
  return errors;
}

// Matches records to the expected calls in order. Two extras are allowed and no other: a second identical GET right
// after a first whose status was not recorded (the transport's one re-send), and a second identical request right
// after a 503 with Retry-After: 0 (OkHttp's own).
export function judgeCapture(records, { expected, host, secrets }) {
  const errors = judgeRecords(records, { host, secrets });
  if (records.length === 0) return [...errors, "ERROR wire capture: the capture is empty; the recorder saw no request"];
  const same = (a, b) => call(a) === call(b) && JSON.stringify(a.queryNames ?? []) === JSON.stringify(b.queryNames ?? []);
  let next = 0;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const following = records[index + 1];
    const resend = following !== undefined && same(record, following);
    const transportResend = resend && record.method === "GET" && record.status === null && !(index > 0 && records[index - 1].status === null && same(records[index - 1], record));
    const okhttpResend = resend && record.status === 503 && record.retryAfter === "0";
    if (transportResend || okhttpResend) continue;
    if (next >= expected.length) {
      errors.push(`ERROR wire capture: request ${index + 1} (${shown(call(record), secrets)}) is more than the ${expected.length} expected`);
      continue;
    }
    if (call(record) !== expected[next]) {
      errors.push(`ERROR wire capture: request ${index + 1} is ${shown(call(record), secrets)}, expected ${shown(expected[next], secrets)}`);
    }
    next += 1;
  }
  if (next < expected.length) errors.push(`ERROR wire capture: ${next} of the ${expected.length} expected requests were recorded`);
  return errors;
}

// T3-11: what artwork-header-and-cache sends besides its images, in order, and the shape of each image request.
export const ARTWORK_CALLS = ["GET /System/Info/Public", "POST /Users/AuthenticateByName", "GET /Items/Latest", "POST /Sessions/Logout"];
const ARTWORK_IMAGE = /^\/Items\/[^/]+\/Images\/Primary$/;
const ARTWORK_QUERY = ["tag", "maxWidth", "quality", "format"];
export const ARTWORK_POSTER_WIDTH = 248;

// `images` is k, from the app's line; `widths` the mock's recorded maxWidth values, undefined for a real server. A repeat
// of an image request is allowed only right after a 503 with Retry-After: 0 (OkHttp's own), as judgeCapture allows.
export function judgeArtworkCapture(records, { host, secrets, images, widths }) {
  const errors = judgeRecords(records, { host, secrets });
  const fail = (text) => errors.push(`ERROR wire artwork: ${text}`);
  const isImage = (record) => record.path.includes("/Images/");
  const others = records.filter((record) => !isImage(record)).map(call);
  if (JSON.stringify(others) !== JSON.stringify(ARTWORK_CALLS)) {
    fail(`the calls other than images were ${others.length} (${others.map((text) => shown(text, secrets)).join(", ")}), expected ${ARTWORK_CALLS.join(", ")} in that order`);
  }
  const latest = records.findIndex((record) => call(record) === "GET /Items/Latest");
  const logout = records.findIndex((record) => call(record) === "POST /Sessions/Logout");
  const seen = new Set();
  let counted = 0;
  records.forEach((record, index) => {
    if (!isImage(record)) return;
    const name = `request ${index + 1} (${shown(call(record), secrets)})`;
    if (record.method !== "GET" || !ARTWORK_IMAGE.test(record.path)) fail(`${name} is not a GET of /Items/{id}/Images/Primary`);
    if (JSON.stringify(record.queryNames ?? []) !== JSON.stringify(ARTWORK_QUERY)) fail(`${name} has query names other than ${ARTWORK_QUERY.join(", ")}`);
    if (latest < 0 || index < latest) fail(`${name} came before GET /Items/Latest`);
    if (logout >= 0 && index > logout) fail(`${name} came after the logout`);
    const following = records[index + 1];
    const retried = record.status === 503 && record.retryAfter === "0" && following !== undefined && following.method === record.method && following.path === record.path;
    if (retried) return;
    if (seen.has(record.path)) fail(`${name} repeats an image request already made; a second visit must come from the cache`);
    seen.add(record.path);
    counted += 1;
  });
  if (!Number.isInteger(images) || images < 1) fail(`the app named ${images ?? "no"} cards with an image; at least one is needed`);
  else if (counted !== images) fail(`${counted} image request(s) recorded for the ${images} card(s) the app named`);
  if (widths !== undefined) {
    if (!Array.isArray(widths) || widths.length === 0) fail("the mock recorded no image width");
    else if (widths.some((width) => width !== ARTWORK_POSTER_WIDTH)) fail(`the mock recorded maxWidth ${widths.join(", ")}; every poster asks for ${ARTWORK_POSTER_WIDTH}`);
  }
  return errors;
}

// A logcat line holds a secret in any form findSecret knows, or a MediaBrowser Token field with a value.
export function judgeLogcat(lines, secrets) {
  const errors = [];
  lines.forEach((line, index) => {
    if (findSecret(line, secrets)) errors.push(`ERROR wire logcat: line ${index + 1} holds a known secret`);
    if (/Token="[^"]/.test(line)) errors.push(`ERROR wire logcat: line ${index + 1} holds a header with a token`);
  });
  return errors;
}

// The one media URL shape a direct play may request (ARCHITECTURE.md section 3, I2): GET /Videos/{32 hex}/stream with
// Static=true. A path that names Videos or Audio in any case is a media request (Jellyfin's routes ignore case).
const STREAM_PATH = /^\/Videos\/[0-9a-f]{32}\/stream$/;
const MEDIA_PATH = /\/(?:videos|audio)\//i;
const CONVERSION_PATHS = [
  [/\.m3u8$/i, "an HLS playlist"],
  [/\/hls/i, "an HLS segment path"],
  [/\/universal/i, "a universal audio path"],
  [/\/subtitles\//i, "a subtitle path"],
  [/\/trickplay\//i, "a trickplay path"],
];
const isStream = (record) => record.method === "GET" && STREAM_PATH.test(record.path);

export function judgePlayerCapture(records) {
  const errors = [];
  records.forEach((record, index) => {
    const name = `request ${index + 1} (${record.method} ${record.path})`;
    for (const [pattern, what] of CONVERSION_PATHS) {
      if (pattern.test(record.path)) errors.push(`ERROR wire player: ${name} is ${what}; a direct play requests only the original file`);
    }
    if (MEDIA_PATH.test(record.path) && !(isStream(record) && record.staticTrue === true)) {
      errors.push(`ERROR wire player: ${name} is a media request that is not GET /Videos/{id}/stream with Static=true`);
    }
  });
  const streams = records.filter(isStream);
  if (streams.length === 0) errors.push("ERROR wire player: the capture holds no GET /Videos/{id}/stream request");
  else if (!streams.some((record) => record.range === true)) errors.push("ERROR wire player: no stream request carried a Range header");
  return errors;
}

// T8-07 item 4: canonicalDigest (tv-wire-proxy.mjs) of OCTAVE_PROFILE (packages/core/src/jellyfin/device-profile.ts)
// without MaxStreamingBitrate. Node cannot load that module here (its imports name no extension), so the value is
// written out, and scripts/tv-wire-capabilities.test.ts fails when it no longer matches the profile.
export const OCTAVE_PROFILE_DIGEST = "e79ae220e230304810e54c6c4470afda9fa2eba6377a7335103aedb9e7b4f933";

// T8-07 item 7: T2-09's expectation per server for a sample whose video codec the device lacks
// (tests/integration/tripwire-expectations.ts, expectationFor(server, "no-av1", "av1")); the test holds them equal, so
// T10-08's change there fails it until this follows.
export const CAPABILITY_EXPECTATIONS = Object.freeze({
  jellyscale: Object.freeze({ kind: "refused", reason: "device-cannot-play" }),
  "jellyfin-12": Object.freeze({ kind: "conversion", methods: Object.freeze(["Transcode"]), clientReason: "DeviceCannotPlay" }),
});

const FIRST_FLAGS = Object.freeze({
  EnableDirectPlay: true,
  EnableDirectStream: true,
  EnableTranscoding: true,
  AllowVideoStreamCopy: true,
  AllowAudioStreamCopy: true,
  AutoOpenLiveStream: false,
});
const FORCED_FLAGS = Object.freeze({ ...FIRST_FLAGS, EnableDirectPlay: false, AllowVideoStreamCopy: false });
const PLAYBACK_INFO_PATH = /^\/Items\/([^/]+)\/PlaybackInfo$/i;

function flagErrors(name, facts, expected) {
  const errors = [];
  for (const [flag, value] of Object.entries(expected)) {
    for (const where of ["body", "query"]) {
      const sent = facts?.[where]?.[flag];
      if (sent !== value) errors.push(`ERROR wire capabilities: ${name} sent ${flag}=${sent ?? "nothing"} in the ${where}, expected ${value}`);
    }
  }
  return errors;
}

export function judgeCapabilityCapture(records) {
  const infos = records.filter((record) => record.method === "POST" && PLAYBACK_INFO_PATH.test(record.path));
  const items = infos.map((record) => PLAYBACK_INFO_PATH.exec(record.path)[1]);
  if (infos.length !== 3 || items[0] === items[1] || items[1] !== items[2]) {
    return [`ERROR wire capabilities: expected one PlaybackInfo for the H.264 item, then two for the no-decoder item; recorded ${infos.length} for ${new Set(items).size} item(s) in another order`];
  }
  const names = ["the H.264 item's PlaybackInfo", "the no-decoder item's first PlaybackInfo", "the no-decoder item's forced PlaybackInfo"];
  const errors = [];
  infos.forEach((record, index) => {
    if (record.playbackInfo === undefined) {
      errors.push(`ERROR wire capabilities: the recorder kept no flags for ${names[index]}`);
      return;
    }
    if (record.playbackInfo.profile !== OCTAVE_PROFILE_DIGEST) errors.push(`ERROR wire capabilities: ${names[index]} did not carry the Octave DeviceProfile`);
    errors.push(...flagErrors(names[index], record.playbackInfo, index === 2 ? FORCED_FLAGS : FIRST_FLAGS));
  });
  return errors;
}

// The words the app writes for the no-decoder sample when the server answers as T2-09 expects.
function noDecoderWords(expectation) {
  if (expectation.kind === "refused") return { nodecoder: "refused", reason: expectation.reason };
  const method = expectation.methods[0] === "Transcode" ? "transcode" : "direct-stream";
  return { nodecoder: method, client: expectation.clientReason ?? "none" };
}

const PLAYING_CALL = "POST /Sessions/Playing";
const PROGRESS_CALL = "POST /Sessions/Playing/Progress";
const STOPPED_CALL = "POST /Sessions/Playing/Stopped";
const REPORT_CALLS = [PLAYING_CALL, PROGRESS_CALL, STOPPED_CALL];

// The first viewing's own progress posts, the least spread of two of its positions, the least position of its stop, and
// how far from that stop the second viewing may start. All in whole seconds.
const FIRST_PROGRESS_POSTS = 2;
const FRESH_SECONDS = 8;
const LEAST_STOP_SECONDS = 20;
const RESUME_SECONDS = 10;
const VIEWING_WORDS = { outcome: "ok", start: "after-first-frame", resume: "at-reported", resumed: "within-10s" };

// The reports as viewings, or null unless they are exactly two, each a start, then progress posts, then one stop.
function viewingsOf(reports) {
  const viewings = [];
  let open = null;
  for (const record of reports) {
    const sent = call(record);
    if ((sent === PLAYING_CALL) !== (open === null)) return null;
    if (sent === PLAYING_CALL) open = { start: record, progress: [], stop: undefined };
    else if (sent === PROGRESS_CALL) open.progress.push(record);
    else {
      viewings.push({ ...open, stop: record });
      open = null;
    }
  }
  return open === null && viewings.length === 2 ? viewings : null;
}

function firstViewingErrors({ progress, stop }) {
  const errors = [];
  if (progress.length < FIRST_PROGRESS_POSTS) errors.push(`the first viewing sent ${progress.length} progress post(s), fewer than ${FIRST_PROGRESS_POSTS}`);
  const positions = progress.map((record) => record.report?.position).filter(Number.isInteger);
  if (positions.length < 2 || Math.max(...positions) - Math.min(...positions) < FRESH_SECONDS) {
    errors.push(`no two progress positions of the first viewing are ${FRESH_SECONDS} s or more apart`);
  }
  if (!progress.some((record) => record.report?.paused === true)) errors.push("no progress post of the first viewing was paused");
  if (stop.report?.failed !== false) errors.push("the first viewing's stop did not say it had not failed");
  if (!(stop.report?.position >= LEAST_STOP_SECONDS)) errors.push(`the first viewing's stop was not at ${LEAST_STOP_SECONDS} s or later`);
  return errors;
}

function resumedStartErrors(first, second) {
  const stopped = first.stop.report?.position;
  const started = second.start.report?.position;
  if (Number.isInteger(stopped) && Number.isInteger(started) && Math.abs(started - stopped) <= RESUME_SECONDS) return [];
  return [`the second viewing did not start within ${RESUME_SECONDS} s of where the first stopped`];
}

export function judgeViewingCapture(records, said) {
  const errors = [];
  for (const [key, value] of Object.entries(VIEWING_WORDS)) {
    if (said[key] !== value) errors.push(`${key}=${said[key] ?? "missing"}, expected ${key}=${value}`);
  }
  const reports = records.filter((record) => REPORT_CALLS.includes(call(record)));
  for (const record of reports) {
    if (!(record.status >= 200 && record.status < 300)) errors.push(`a ${call(record)} was answered ${record.status ?? "with nothing"}, not 2xx`);
    if (record.report?.method !== "DirectPlay") errors.push(`a ${call(record)} did not name the play method DirectPlay`);
  }
  const viewings = viewingsOf(reports);
  if (viewings === null) errors.push("the reports are not two viewings, each one start, progress posts and one stop in order");
  else errors.push(...firstViewingErrors(viewings[0]), ...resumedStartErrors(viewings[0], viewings[1]));
  return [...errors.map((text) => `ERROR wire viewing: ${text}`), ...judgePlayerCapture(records)];
}

// player-transport's keys, in order (T8-04, D13). The runner sends them and keeps this account; the app cannot write it.
const TRANSPORT_KEYS = [
  ...["DPAD_RIGHT", "MEDIA_PLAY_PAUSE"],
  ...["DPAD_RIGHT", "DPAD_RIGHT", "DPAD_LEFT"],
  ...["DPAD_DOWN", "DPAD_CENTER", "DPAD_CENTER", "MEDIA_PLAY_PAUSE"],
  ...["DPAD_CENTER", "DPAD_CENTER", "MEDIA_PLAY_PAUSE"],
  "BACK",
];
// A word may be said twice (centre, centre-wake), so the result line's tokens are held, not one value per name.
const TRANSPORT_WORDS = [
  ...["outcome=ok", "wake=no-seek", "pause=ok", "seek=+20", "back=-10"],
  ...["centre=resumed", "centre=paused", "resume=ok", "centre-wake=shown", "centre-wake=focused", "stop=back"],
];
// An arrow that seeked lands at 10 s or later, whatever it seeked from.
const WAKE_UNDER_SECONDS = 10;
// The file is 60 s long, so a stop before this was not the file's end.
const STOP_UNDER_SECONDS = 50;
const SEEK_NEAR_SECONDS = 2;
// Where the first paused run's positions are, from its first: the pause, two seeks forward and one back.
const SEEK_OFFSETS = [0, 10, 20, 10];
// Seven keys that pause or resume make three pauses and three resumes only if each of them did what it should.
const PAUSED_RUNS = 3;

// The progress posts' reports as runs of consecutive paused posts.
function pausedRuns(reports) {
  const runs = [];
  let open = null;
  for (const report of reports) {
    if (report?.paused !== true) {
      open = null;
      continue;
    }
    if (open === null) {
      open = [];
      runs.push(open);
    }
    open.push(report);
  }
  return runs;
}

// The positions in order, each repeat of the one before it (within SEEK_NEAR_SECONDS) left out.
function distinctPositions(reports) {
  const positions = [];
  for (const { position } of reports) {
    if (positions.length > 0 && Math.abs(position - positions.at(-1)) <= SEEK_NEAR_SECONDS) continue;
    positions.push(position);
  }
  return positions;
}

function wakeErrors(progress) {
  const firstPaused = progress.findIndex((record) => record.report?.paused === true);
  if (firstPaused < 0) return ["no progress post was paused"];
  const early = progress.slice(0, firstPaused + 1);
  if (early.every((record) => record.report?.position < WAKE_UNDER_SECONDS)) return [];
  return [`a progress post up to the first paused one was at ${WAKE_UNDER_SECONDS} s or later (the arrow that woke the controls seeked, or the run was too slow to tell)`];
}

function seekErrors(run) {
  const positions = distinctPositions(run);
  const moved = positions.map((position) => position - positions[0]);
  const asExpected = moved.length === SEEK_OFFSETS.length && SEEK_OFFSETS.every((offset, index) => Math.abs(moved[index] - offset) <= SEEK_NEAR_SECONDS);
  if (asExpected) return [];
  return [`the first paused run moved by ${moved.join(", ")} s, expected ${SEEK_OFFSETS.join(", ")}`];
}

function transportReportErrors(reports) {
  const calls = reports.map(call);
  const inShape = calls[0] === PLAYING_CALL && calls.at(-1) === STOPPED_CALL && calls.slice(1, -1).every((sent) => sent === PROGRESS_CALL);
  if (!inShape) return ["the reports are not one start, progress posts and one stop in that order"];
  const progress = reports.slice(1, -1);
  const stop = reports.at(-1).report;
  const runs = pausedRuns(progress.map((record) => record.report));
  const errors = wakeErrors(progress);
  if (runs.length > 0) errors.push(...seekErrors(runs[0]));
  if (runs.length !== PAUSED_RUNS) errors.push(`the progress posts hold ${runs.length} paused run(s), expected ${PAUSED_RUNS}`);
  if (progress.at(-1)?.report?.paused !== false) errors.push("the last progress post before the stop was not playing");
  if (stop?.failed !== false) errors.push("the stop did not say it had not failed");
  if (!(stop?.position < STOP_UNDER_SECONDS)) errors.push(`the stop was not under ${STOP_UNDER_SECONDS} s, so Back may not be what stopped it`);
  return errors;
}

// One read of the window in each state: the flag while playing, and not while paused. A read that did not find Octave's
// window proves neither.
function windowErrors(windows) {
  return [
    ["paused", false],
    ["playing", true],
  ].flatMap(([state, expected]) => {
    const reads = windows.filter((read) => read.state === state);
    if (reads.length !== 1) return [`the runner read the window ${reads.length} time(s) while ${state}, expected once`];
    if (reads[0].found !== true) return [`Octave's window was not found in the read while ${state}`];
    if (reads[0].keepScreenOn !== expected) return [`the window ${expected ? "did not hold" : "held"} KEEP_SCREEN_ON while ${state}`];
    return [];
  });
}

export function judgeTransportCapture(records, tokens, { keys = [], windows = [] } = {}) {
  const errors = TRANSPORT_WORDS.filter((word) => !tokens.includes(word)).map((word) => `the app did not say ${word}`);
  if (keys.join(" ") !== TRANSPORT_KEYS.join(" ")) {
    errors.push(`the runner sent ${keys.length} key(s) (${keys.join(" ")}), expected ${TRANSPORT_KEYS.join(" ")}`);
  }
  const reports = records.filter((record) => REPORT_CALLS.includes(call(record)));
  for (const record of reports) {
    if (!(record.status >= 200 && record.status < 300)) errors.push(`a ${call(record)} was answered ${record.status ?? "with nothing"}, not 2xx`);
    if (record.report?.method !== "DirectPlay") errors.push(`a ${call(record)} did not name the play method DirectPlay`);
  }
  errors.push(...transportReportErrors(reports), ...windowErrors(windows));
  return [...errors.map((text) => `ERROR wire transport: ${text}`), ...judgePlayerCapture(records)];
}

const words = (line) => Object.fromEntries([...line.matchAll(/(\S+?)=(\S*)/g)].map(([, key, value]) => [key, value]));
const count = (value) => (Number.isInteger(value) ? value : null);

// The rule per test id: (pair, words of the app's result line, the line's tokens) => ERROR lines.
export const WIRE_JUDGES = {
  "transport-probe-then-signed-in": (pair, said) => {
    if (said.outcome !== "ok") return [`ERROR wire ${pair.test} ${pair.target}: the gateway's probe, sign-in, views and logout did not finish (outcome=${said.outcome ?? "missing"})`];
    return [];
  },
  "transport-redirect": (pair, said) => {
    const errors = [];
    if (said.code !== "redirect") errors.push(`ERROR wire ${pair.test} ${pair.target}: the transport reported code=${said.code ?? "missing"}, not the redirect error`);
    if (said.gateway !== "redirect") errors.push(`ERROR wire ${pair.test} ${pair.target}: the gateway reported ${said.gateway ?? "nothing"}, not its redirect failure`);
    if (!(count(pair.redirector) >= 1)) errors.push(`ERROR wire ${pair.test} ${pair.target}: the redirector saw no request`);
    return errors;
  },
  "transport-canary": (pair, said) => {
    const errors = [];
    const crossings = Number(said.crossings);
    if (!Number.isInteger(crossings) || crossings < MIN_CANARY_CROSSINGS) {
      errors.push(`ERROR wire ${pair.test} ${pair.target}: ${said.crossings ?? "no"} seam crossings recorded, fewer than ${MIN_CANARY_CROSSINGS}`);
    }
    if (said.selftest !== "ok") errors.push(`ERROR wire ${pair.test} ${pair.target}: the seam scan's self-test did not pass (selftest=${said.selftest ?? "missing"})`);
    if (said.canary !== "absent") errors.push(`ERROR wire ${pair.test} ${pair.target}: the canary token crossed the seam (canary=${said.canary ?? "missing"})`);
    return errors;
  },
  "transport-errors": (pair, said) => {
    const expected = {
      network: "network",
      timeout: "timeout",
      cancelled: "cancelled",
      refused: "refused",
      unexpected: "unexpected-response",
      status: "status-401",
      concurrent: "ok",
      leak: "absent",
    };
    return Object.entries(expected)
      .filter(([key, value]) => said[key] !== value)
      .map(([key, value]) => `ERROR wire ${pair.test} ${pair.target}: ${key}=${said[key] ?? "missing"}, expected ${key}=${value}`);
  },
  // T8-02 item 7: the play of the H.264 sample from the pinned Jellyscale, step by step.
  "player-original-file": (pair, said) => {
    const expected = { outcome: "ok", plan: "original", firstFrame: "after-loaded", pause: "ok", seek: "ok", stop: "ok", relaunch: "ok" };
    return Object.entries(expected)
      .filter(([key, value]) => said[key] !== value)
      .map(([key, value]) => `ERROR wire ${pair.test} ${pair.target}: ${key}=${said[key] ?? "missing"}, expected ${key}=${value}`);
  },
  // T8-02 item 6: each sample against the device's own decoder list (pair.decoders, read by the runner).
  "player-samples": (pair, said) => {
    const errors = [];
    const fail = (text) => errors.push(`ERROR wire ${pair.test} ${pair.target}: ${text}`);
    if (said.h264 !== "first-frame") fail(`h264=${said.h264 ?? "missing"}, expected the first frame`);
    if (said.nodecoder !== "decoder-unavailable") fail(`nodecoder=${said.nodecoder ?? "missing"}, expected decoder-unavailable`);
    if (!["hardware", "software"].includes(said["decode-h264"])) fail(`decode-h264=${said["decode-h264"] ?? "missing"}, expected hardware or software`);
    if (said.label !== "present") fail(`label=${said.label ?? "missing"}, expected the decoder's name`);
    const decoders = pair.decoders;
    for (const key of ["hevc", "av1"]) {
      const listed = decoders?.[key];
      if (typeof listed?.type !== "boolean" || typeof listed?.profile !== "boolean") {
        fail(`the device's decoder list for ${key} could not be read, so ${key}=${said[key] ?? "missing"} cannot pass`);
        continue;
      }
      // A decoder for the type but not the profile: Media3 tries the track (E6), so it may play, fail, or find none.
      const allowed = listed.type && listed.profile ? ["first-frame"] : !listed.type ? ["decoder-unavailable"] : ["first-frame", "decoder-failed", "decoder-unavailable"];
      if (!allowed.includes(said[key])) fail(`${key}=${said[key] ?? "missing"}, expected ${allowed.join(" or ")} for the device's decoder list`);
    }
    return errors;
  },
  // T8-02 item 5: the mock answers the stream with a 302 to the canary origin; the one client refuses it once.
  "player-redirect": (pair, said) => {
    const errors = [];
    if (said.code !== "server-error") errors.push(`ERROR wire ${pair.test} ${pair.target}: code=${said.code ?? "missing"}, expected server-error`);
    if (!Array.isArray(pair.records)) return [...errors, `ERROR wire ${pair.test} ${pair.target}: no records to judge the stream request by`];
    const streams = pair.records.filter((record) => record.method === "GET" && /^\/videos\/[^/]+\/stream$/i.test(record.path));
    if (streams.length !== 1) errors.push(`ERROR wire ${pair.test} ${pair.target}: ${streams.length} stream requests recorded, expected exactly one`);
    else if (streams[0].status !== 302) errors.push(`ERROR wire ${pair.test} ${pair.target}: the stream request was answered ${streams[0].status ?? "with nothing"}, not 302`);
    return errors;
  },
  // T8-07 items 1, 2, 3, 6, 7 and 8: the app's probe-backed gateway plays the H.264 sample and negotiates the
  // no-decoder one; the requests on the wire and the words against the device's decoder list and T2-09's expectation.
  "player-capabilities": (pair, said) => {
    const errors = [];
    const fail = (text) => errors.push(`ERROR wire ${pair.test} ${pair.target}: ${text}`);
    if (!Array.isArray(pair.records)) fail("no records to judge the PlaybackInfo requests by");
    else errors.push(...judgeCapabilityCapture(pair.records));
    const hevc = pair.decoders?.hevc?.type;
    if (typeof hevc !== "boolean") fail("the device's decoder list could not be read, so hevcmain cannot pass");
    const expectation = CAPABILITY_EXPECTATIONS[pair.target];
    if (expectation === undefined) fail("no T2-09 expectation for this target");
    const expected = {
      outcome: "ok",
      probe: "complete",
      h264main: "listed",
      ...(hevc === true ? { hevcmain: "listed" } : {}),
      h264plan: "original",
      h264: "first-frame",
      ...(expectation === undefined ? {} : noDecoderWords(expectation)),
    };
    for (const [key, value] of Object.entries(expected)) {
      if (said[key] !== value) fail(`${key}=${said[key] ?? "missing"}, expected ${key}=${value}`);
    }
    return errors;
  },
  // T8-03 items 2, 4, 7 and 8: two viewings through the core's coordinator, judged by their reports and words.
  "player-viewing": (pair, said) => {
    if (!Array.isArray(pair.records)) return [`ERROR wire ${pair.test} ${pair.target}: no records to judge the reports by`];
    return judgeViewingCapture(pair.records, said);
  },
  // T8-04 items 1, 2, 3, 5 and 8: the player screen driven by the remote's keys, judged by its reports, the runner's
  // keys and window reads, and the words.
  "player-transport": (pair, _said, tokens) => {
    if (!Array.isArray(pair.records)) return [`ERROR wire ${pair.test} ${pair.target}: no records to judge the reports by`];
    return judgeTransportCapture(pair.records, tokens, { keys: pair.keys, windows: pair.windows });
  },
  // T3-11 item 4: every card loaded on the first visit and again, from the cache, on the second.
  "artwork-header-and-cache": (pair, said) => {
    const errors = [];
    const fail = (text) => errors.push(`ERROR wire ${pair.test} ${pair.target}: ${text}`);
    if (said.outcome !== "ok") fail(`outcome=${said.outcome ?? "missing"}, expected outcome=ok`);
    const images = /^[0-9]+$/.test(said.images ?? "") ? Number(said.images) : null;
    if (images === null || images < 1) {
      fail(`images=${said.images ?? "missing"}, expected at least one card with an image`);
      return errors;
    }
    for (const key of ["first", "second"]) {
      if (said[key] !== `${images}/${images}`) fail(`${key}=${said[key] ?? "missing"}, expected ${key}=${images}/${images}`);
    }
    return errors;
  },
  // T3-11 item 6: the scroll through the fixture Home with the canary as the token.
  "artwork-canary": (pair, said) => {
    const errors = [];
    const fail = (text) => errors.push(`ERROR wire ${pair.test} ${pair.target}: ${text}`);
    const atLeast = (key, least) => {
      const value = /^[0-9]+$/.test(said[key] ?? "") ? Number(said[key]) : null;
      if (value === null || value < least) fail(`${key}=${said[key] ?? "missing"}, expected at least ${least}`);
    };
    if (said.canary !== "absent") fail(`the canary token reached a prop, an event or the seam (canary=${said.canary ?? "missing"})`);
    if (said.selftest !== "ok") fail(`the scan's self-test did not pass (selftest=${said.selftest ?? "missing"})`);
    atLeast("viewProps", 24);
    atLeast("events", 24);
    atLeast("failed", 1);
    return errors;
  },
  "transport-private-lan-and-proxy": (pair, said) => {
    const errors = [];
    if (said.probe !== "ok") errors.push(`ERROR wire ${pair.test} ${pair.target}: the app's direct probe said probe=${said.probe ?? "missing"}, not probe=ok`);
    if (!(count(pair.privateLan) >= 1)) {
      errors.push(`ERROR wire ${pair.test} ${pair.target}: the private-LAN origin recorded no direct plain-HTTP request to 10.0.2.2 (privateLan=${pair.privateLan ?? "absent"})`);
    }
    return errors;
  },
};

// The app's lines against the selected pairs and the host's counts.
export function judgeWire({ pairs, lines }) {
  const errors = [];
  const messages = lines.map((line) => line.trim());
  if (pairs.length === 0) errors.push("ERROR wire: the run selected no test");
  if (!messages.includes("OCTAVE_WIRE done")) errors.push("ERROR wire: no OCTAVE_WIRE done line; the app's wire run did not finish");
  for (const pair of pairs) {
    const tag = `test=${pair.test} target=${pair.target}`;
    const name = `${pair.test} ${pair.target}`;
    if (messages.some((line) => line === `OCTAVE_WIRE unreachable ${tag}`)) {
      errors.push(`ERROR wire ${name}: the app found the target unreachable`);
      continue;
    }
    const results = messages.filter((line) => line.startsWith(`OCTAVE_WIRE result ${tag} `) || line === `OCTAVE_WIRE result ${tag}`);
    if (results.length === 0) {
      errors.push(`ERROR wire ${name}: the app wrote no result line for the selected test`);
      continue;
    }
    if (results.length > 1) errors.push(`ERROR wire ${name}: the app wrote ${results.length} result lines`);
    const said = words(results[0]);
    if (said.task !== pair.task) errors.push(`ERROR wire ${name}: the result line names task ${said.task ?? "none"}, not ${pair.task}`);
    if (!(count(pair.requests) >= 1)) errors.push(`ERROR wire ${name}: the recorder captured zero requests`);
    if (count(pair.canaryOrigin) !== null && pair.canaryOrigin > 0) errors.push(`ERROR wire ${name}: the canary origin received ${pair.canaryOrigin} request(s)`);
    const judge = WIRE_JUDGES[pair.test];
    if (typeof judge !== "function") errors.push(`ERROR wire ${name}: no host judge for this test`);
    else errors.push(...judge(pair, said, results[0].split(/\s+/)));
  }
  return errors;
}
