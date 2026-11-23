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

const words = (line) => Object.fromEntries([...line.matchAll(/(\S+?)=(\S*)/g)].map(([, key, value]) => [key, value]));
const count = (value) => (Number.isInteger(value) ? value : null);

// The rule per test id: (pair, words of the app's result line) => ERROR lines.
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
    else errors.push(...judge(pair, said));
  }
  return errors;
}
