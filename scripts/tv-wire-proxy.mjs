// The recorder of pnpm tv:wire (T3-05; docs/specs/T3-05.md, "The wire runner"): a reverse proxy on 127.0.0.1 in front
// of one upstream, one per (test, target) pair, reached from the emulator through adb reverse. For every request it
// keeps what judgeCapture reads and nothing else: method, path, query names, whether Authorization is present, its
// scheme, whether its Token field is non-empty, the Host, the upstream's status and Retry-After, and whether the URL
// holds a known secret (a field that holds one is stored as the stand-in of tv-wire-evidence.mjs). It never stores a
// header value, a query value or a body.
//
// For a real fixture server it swaps the placeholder user and password in POST /Users/AuthenticateByName for the
// server's own (from tests/integration/.credentials), so the fixture password never reaches the device, and reads
// the issued token from the answer so the judges know what to look for.
//
// T8-02 adds two booleans per request, `range` (a Range header was sent) and `staticTrue` (exactly one query parameter
// named Static whose decoded value is "true"), and learns the PlaySessionId of every PlaybackInfo answer it relays:
// each joins the run's secrets, so a play-session id in any logcat line fails the run. The stream URL carries its own
// play session as the PlaySessionId value, which the server issued for that URL, so that one value is left out of the
// URL's secret scan; anywhere else in a URL a play-session id is a secret like any other.
//
// T8-07 adds `playbackInfo` to every POST …/PlaybackInfo record and to no other: the six PlaybackInfo flags as the body
// states them (a JSON boolean) and as the query states them (exactly one parameter whose value is true or false in
// any case), each true, false or null, and the SHA-256 of the body's DeviceProfile without its MaxStreamingBitrate
// (canonicalDigest), so the judge can tell that both requests carry the same flags in both places and the one
// Octave profile. No other value of the body or query is kept.
//
// T8-03 adds `report` to every POST /Sessions/Playing, /Sessions/Playing/Progress and /Sessions/Playing/Stopped record
// and to no other: the whole seconds of the body's PositionTicks and its IsPaused and Failed, each read only when its
// JSON type is right, and its PlayMethod only when it is DirectPlay, DirectStream or Transcode; each is else null.
// Nothing else of the body is kept, so no id is.
//
// Also here: the global-proxy listener, which records the requests that arrive when the emulator's http_proxy names
// it, and a health check for the fixture servers.
import { createHash } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { safeRecord, safeUrlParts } from "./tv-wire-evidence.mjs";

const LOOPBACK = "127.0.0.1";

function readBody(stream) {
  return new Promise((resolve) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", () => resolve(Buffer.concat(chunks)));
  });
}

// What the recorder keeps of one request's Authorization value: presence, scheme, and whether Token has a value.
export function describeAuthorization(value) {
  if (typeof value !== "string" || value === "") return { authorization: false, scheme: null, token: false };
  const scheme = value.split(" ")[0];
  const field = /(?:^|[ ,])Token="([^"]*)"/.exec(value);
  return { authorization: true, scheme, token: field !== null && field[1] !== "" };
}

// True when the query holds exactly one parameter named Static and its decoded value is "true".
export function staticTrue(rawUrl) {
  const mark = rawUrl.indexOf("?");
  if (mark < 0) return false;
  const values = rawUrl
    .slice(mark + 1)
    .split("#")[0]
    .split("&")
    .filter((part) => part !== "")
    .map((part) => (part.includes("=") ? [part.slice(0, part.indexOf("=")), part.slice(part.indexOf("=") + 1)] : [part, null]))
    .filter(([name]) => name === "Static")
    .map(([, value]) => value);
  if (values.length !== 1 || values[0] === null) return false;
  try {
    return decodeURIComponent(values[0].replace(/\+/g, " ")) === "true";
  } catch {
    return false;
  }
}

// The flags of a PlaybackInfo request (packages/core/src/jellyfin/gateway.ts, PLAYBACK_INFO_FLAGS).
const PLAYBACK_INFO_FLAG_NAMES = ["EnableDirectPlay", "EnableDirectStream", "EnableTranscoding", "AllowVideoStreamCopy", "AllowAudioStreamCopy", "AutoOpenLiveStream"];

// JSON with object keys sorted at every level and no whitespace; arrays keep their order.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// The SHA-256 hex of the canonical JSON of `value`.
export function canonicalDigest(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

// A query key as the server binds it: decoded and compared without case (ASP.NET Core's model binding). A key that
// does not decode matches nothing.
function queryKey(raw) {
  try {
    return decodeURIComponent(raw.replace(/\+/g, " ")).toLowerCase();
  } catch {
    return null;
  }
}

function queryFlag(rawUrl, name) {
  const mark = rawUrl.indexOf("?");
  if (mark < 0) return null;
  const wanted = name.toLowerCase();
  const values = rawUrl
    .slice(mark + 1)
    .split("#")[0]
    .split("&")
    .filter((part) => part !== "")
    .map((part) => (part.includes("=") ? [part.slice(0, part.indexOf("=")), part.slice(part.indexOf("=") + 1)] : [part, null]))
    .filter(([key]) => queryKey(key) === wanted)
    .map(([, value]) => value);
  if (values.length !== 1 || values[0] === null) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(values[0].replace(/\+/g, " ")).toLowerCase();
  } catch {
    return null;
  }
  return decoded === "true" ? true : decoded === "false" ? false : null;
}

// What the recorder keeps of a PlaybackInfo request: { body, query, profile } (see the header).
export function playbackInfoFacts(body, rawUrl) {
  let fields = null;
  try {
    const parsed = JSON.parse(body);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) fields = parsed;
  } catch {
    // Not JSON: every body flag and the profile are null.
  }
  const bodyFlags = {};
  const queryFlags = {};
  for (const name of PLAYBACK_INFO_FLAG_NAMES) {
    bodyFlags[name] = typeof fields?.[name] === "boolean" ? fields[name] : null;
    queryFlags[name] = queryFlag(rawUrl, name);
  }
  const device = fields?.DeviceProfile;
  let profile = null;
  if (device !== null && typeof device === "object" && !Array.isArray(device)) {
    const { MaxStreamingBitrate: _limit, ...rest } = device;
    profile = canonicalDigest(rest);
  }
  return { body: bodyFlags, query: queryFlags, profile };
}

// The playstate posts the recorder keeps report facts of.
const REPORT_PATH = /\/Sessions\/Playing(?:\/Progress|\/Stopped)?$/;
const TICKS_PER_SECOND = 10_000_000;
// The only play methods kept: any other string could carry anything into the evidence.
const PLAY_METHODS = new Set(["DirectPlay", "DirectStream", "Transcode"]);

// What the recorder keeps of a playstate post: { position, paused, failed, method } (see the header).
export function reportFacts(body) {
  let fields = null;
  try {
    fields = JSON.parse(body);
  } catch {
    // Not JSON: every fact is null.
  }
  const read = (name, type) => (typeof fields?.[name] === type ? fields[name] : null);
  const ticks = read("PositionTicks", "number");
  return {
    position: ticks === null ? null : Math.floor(ticks / TICKS_PER_SECOND),
    paused: read("IsPaused", "boolean"),
    failed: read("Failed", "boolean"),
    method: PLAY_METHODS.has(fields?.PlayMethod) ? fields.PlayMethod : null,
  };
}

// The URL with the value of each PlaySessionId parameter that is a play session this run learned blanked, for the
// secret scan only.
export function withoutOwnPlaySession(rawUrl, playSessions) {
  if (playSessions.size === 0) return rawUrl;
  return rawUrl.replace(/([?&]PlaySessionId=)([^&#]*)/g, (whole, name, value) => {
    let decoded = value;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      return whole;
    }
    return playSessions.has(decoded) ? name : whole;
  });
}

// upstream: { port }; secrets: a Set the runner shares across recorders (known secrets, plus each issued token);
// swap: { from: { user, password }, to: { user, password } } for a real server, or undefined.
export function startRecorder({ upstream, secrets, swap }) {
  const records = [];
  // The play sessions this recorder relayed; each is also in `secrets`.
  const playSessions = new Set();
  const server = createServer({ keepAliveTimeout: 120_000 }, async (incoming, outgoing) => {
    const url = new URL(incoming.url ?? "/", "http://recorder.invalid");
    // The record holds a stand-in for a path, a query name, the Host or the scheme that holds a known secret, so
    // nothing the recorder keeps can leak one into the evidence; the upstream request still uses the real URL.
    const known = [...secrets];
    const parts = safeUrlParts(withoutOwnPlaySession(incoming.url ?? "/", playSessions), known);
    const record = safeRecord(
      {
        method: incoming.method ?? "",
        ...parts,
        ...describeAuthorization(incoming.headers.authorization),
        host: incoming.headers.host ?? "",
        status: null,
        retryAfter: null,
        range: typeof incoming.headers.range === "string" && incoming.headers.range !== "",
        staticTrue: staticTrue(incoming.url ?? "/"),
      },
      known,
    );
    records.push(record);
    let body = await readBody(incoming);
    const signIn = record.method === "POST" && url.pathname.endsWith("/Users/AuthenticateByName");
    const playbackInfo = record.method === "POST" && /\/PlaybackInfo$/i.test(url.pathname);
    if (playbackInfo) record.playbackInfo = playbackInfoFacts(body.toString("utf8"), incoming.url ?? "/");
    if (record.method === "POST" && REPORT_PATH.test(url.pathname)) record.report = reportFacts(body.toString("utf8"));
    if (signIn && swap) {
      try {
        const fields = JSON.parse(body.toString("utf8"));
        if (fields.Username === swap.from.user) fields.Username = swap.to.user;
        if (fields.Pw === swap.from.password) fields.Pw = swap.to.password;
        body = Buffer.from(JSON.stringify(fields), "utf8");
      } catch {
        // Not JSON: forwarded as it is.
      }
    }
    const headers = { ...incoming.headers, host: `${LOOPBACK}:${upstream.port}`, "content-length": String(body.length) };
    delete headers["transfer-encoding"];
    const forward = httpRequest({ host: LOOPBACK, port: upstream.port, method: incoming.method, path: incoming.url, headers }, async (answer) => {
      const answerBody = await readBody(answer);
      record.status = answer.statusCode ?? null;
      const retryAfter = answer.headers["retry-after"];
      record.retryAfter = typeof retryAfter === "string" ? retryAfter : null;
      if (playbackInfo && record.status >= 200 && record.status < 300) {
        try {
          const playSession = JSON.parse(answerBody.toString("utf8")).PlaySessionId;
          if (typeof playSession === "string" && playSession !== "") {
            playSessions.add(playSession);
            secrets.add(playSession);
          }
        } catch {
          // No play session to learn.
        }
      }
      if (signIn && record.status >= 200 && record.status < 300) {
        try {
          const issued = JSON.parse(answerBody.toString("utf8")).AccessToken;
          if (typeof issued === "string" && issued !== "") secrets.add(issued);
        } catch {
          // No token to learn.
        }
      }
      const back = { ...answer.headers, "content-length": String(answerBody.length) };
      delete back["transfer-encoding"];
      outgoing.writeHead(answer.statusCode ?? 502, back);
      outgoing.end(answerBody);
    });
    forward.on("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502, { "content-length": "0" });
      outgoing.end();
    });
    // The app went away before the answer (a timeout or a dropped call): stop waiting on the upstream.
    outgoing.on("close", () => {
      if (!outgoing.writableEnded) forward.destroy();
    });
    forward.end(body);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOOPBACK, () =>
      resolve({
        port: server.address().port,
        records,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      }),
    );
  });
}

// The global-proxy listener: records the target of every request or CONNECT that arrives, and answers 502.
export function startProxyListener() {
  const seen = [];
  const server = createServer((incoming, outgoing) => {
    seen.push({ method: incoming.method ?? "", target: incoming.url ?? "", host: incoming.headers.host ?? "" });
    outgoing.writeHead(502, { "content-length": "0", connection: "close" });
    outgoing.end();
  });
  server.on("connect", (incoming, socket) => {
    seen.push({ method: "CONNECT", target: incoming.url ?? "", host: incoming.headers.host ?? "" });
    socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOOPBACK, () =>
      resolve({
        port: server.address().port,
        seen,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      }),
    );
  });
}

// The proxied requests that name a wire target: a Host or a target holding one of the ports, on any host. The
// system's own traffic through the proxy names other hosts and is not a failure (docs/specs/T3-05.md, spec check 2).
export function proxyRequestsNamingTargets(seen, ports) {
  const named = new RegExp(`:(?:${ports.join("|")})(?![0-9])`);
  return seen.filter((entry) => named.test(entry.host) || named.test(entry.target));
}

// True when a fixture server answers its public info.
export async function serverAnswers(url) {
  try {
    const response = await fetch(`${url}/System/Info/Public`, { signal: AbortSignal.timeout(5_000), redirect: "manual" });
    return response.status === 200;
  } catch {
    return false;
  }
}
