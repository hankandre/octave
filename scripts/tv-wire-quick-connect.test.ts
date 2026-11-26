// @vitest-environment node
// T4-03 items 3 and 9, the host half of the wire test sign-in-quick-connect (docs/specs/T4-03.md, D12): what the judge
// accepts, and how the recorder treats the Quick Connect secret. The device half is `pnpm tv:wire --task T4-03`.
// Jellyfin's secret is 64 hex characters, written in uppercase by the server's source; both cases are held here.
import { createServer, request, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { judgeQuickConnectCapture, judgeLogcat, judgeRecords, type CaptureRecord } from "./tv-wire-judge.mjs";
import { startRecorder, withoutOwnQuickConnectSecret } from "./tv-wire-proxy.mjs";

const UPPER = "0123456789ABCDEF".repeat(4);
const LOWER = "fedcba9876543210".repeat(4);
const CODE = "482913";
const POLL = "/QuickConnect/Connect";
const PORT = 47320;
const HOST = `127.0.0.1:${PORT}`;
const SAID = { outcome: "ok", home: "shown" };
const TOKEN = "9f8e7d6c5b4a39281706f5e4d3c2b1a0";
const LEARNED_FROM = ["/QuickConnect/Initiate", "/Users/AuthenticateWithQuickConnect"];

const TOKENLESS = ["/System/Info/Public", "/QuickConnect/Enabled", "/QuickConnect/Initiate", POLL, "/Users/AuthenticateWithQuickConnect"];

function rec(method: string, path: string, extra: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    method,
    path,
    queryNames: path === POLL ? ["secret"] : [],
    authorization: true,
    scheme: "MediaBrowser",
    token: !TOKENLESS.includes(path),
    host: HOST,
    status: 200,
    retryAfter: null,
    secretInUrl: false,
    ...(LEARNED_FROM.includes(path) ? { learned: true } : {}),
    ...extra,
  };
}

const signInCalls = (): CaptureRecord[] => [
  rec("GET", "/System/Info/Public"),
  rec("GET", "/QuickConnect/Enabled"),
  rec("POST", "/QuickConnect/Initiate"),
  rec("GET", POLL),
  rec("GET", POLL),
  rec("POST", "/Users/AuthenticateWithQuickConnect"),
];
const homeReads = (): CaptureRecord[] => [rec("GET", "/UserItems/Resume"), rec("GET", "/Items/Latest")];
const goodCapture = (): CaptureRecord[] => [...signInCalls(), ...homeReads(), rec("POST", "/Sessions/Logout", { status: 204 })];

const judge = (records: CaptureRecord[], said: Record<string, string> = SAID) => [
  ...judgeRecords(records, { host: HOST, secrets: [UPPER] }),
  ...judgeQuickConnectCapture(records, said),
];

describe("T4-03 item 3: the judge of a Quick Connect sign-in's capture", () => {
  it("passes a code polled, signed in once, and Home read with the token", () => {
    expect(judge(goodCapture())).toEqual([]);
  });

  it("fails a poll after the sign-in", () => {
    expect(judge([...goodCapture(), rec("GET", POLL)])).toEqual([expect.stringContaining("polling did not stop")]);
  });

  it("fails a token on a poll", () => {
    const records = goodCapture();
    records[3] = rec("GET", POLL, { token: true });
    expect(judge(records)).toEqual([expect.stringContaining("carries a token on a tokenless call")]);
  });

  it("fails a capture with no sign-in", () => {
    const records = goodCapture().filter((record) => record.path !== "/Users/AuthenticateWithQuickConnect");
    expect(judge(records).join("\n")).toContain("0 sign-in(s)");
  });

  it("fails when no read of Home carries a token after the sign-in", () => {
    expect(judge(signInCalls())).toEqual([expect.stringContaining("no read of Home")]);
  });

  it("fails a sign-in with no poll before it", () => {
    const records = goodCapture().filter((record) => record.path !== POLL);
    expect(judge(records).join("\n")).toContain("no poll followed the Initiate");
  });

  it.each([
    ["secret", 2],
    ["token", 5],
  ])("fails when the recorder learned no %s, so no leak check could find it", (what, index) => {
    const records = goodCapture();
    records[index] = { ...records[index], learned: false } as CaptureRecord;

    expect(judge(records)).toEqual([expect.stringContaining(`learned no ${what}`)]);
  });

  it.each([
    ["Home was never drawn", { outcome: "no-home" }],
    ["the app said nothing of Home", { outcome: "ok" }],
  ])("fails when %s", (_name, said) => {
    expect(judge(goodCapture(), said).length).toBeGreaterThan(0);
  });
});

describe("T4-03 item 3: the recorder blanks only the poll's own learned secret", () => {
  const own = new Set([UPPER]);
  // %41 is "A": an escape no encoder writes, which the server still reads as the secret.
  const escaped = UPPER.replaceAll("A", "%41");

  it.each([
    ["the poll", `${POLL}?secret=${UPPER}`, `${POLL}?secret=`],
    ["the poll under a base path", `/jellyfin${POLL}?secret=${UPPER}`, `/jellyfin${POLL}?secret=`],
    ["the secret with a non-canonical escape", `${POLL}?secret=${escaped}`, `${POLL}?secret=`],
  ])("blanks %s", (_name, url, scanned) => {
    expect(withoutOwnQuickConnectSecret("GET", url, own)).toBe(scanned);
  });

  it.each([
    ["another path", "GET", `/Items?secret=${UPPER}`],
    ["another method", "POST", `${POLL}?secret=${UPPER}`],
    ["a double-encoded value", "GET", `${POLL}?secret=${UPPER.replaceAll("A", "%2541")}`],
    ["a longer value holding it", "GET", `${POLL}?secret=x${UPPER}`],
    ["another parameter name", "GET", `${POLL}?Secret=${UPPER}`],
    ["a value that does not decode", "GET", `${POLL}?secret=${UPPER}%`],
    ["another case of the value", "GET", `${POLL}?secret=${UPPER.toLowerCase()}`],
    ["a secret it never learned", "GET", `${POLL}?secret=${LOWER}`],
  ])("keeps %s", (_name, method, url) => {
    expect(withoutOwnQuickConnectSecret(method, url, own)).toBe(url);
  });
});

describe("T4-03 item 3: a learned secret fails the run everywhere but its own poll", () => {
  const servers: Server[] = [];
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of closers.splice(0)) await close();
    for (const server of servers.splice(0)) await new Promise<void>((done) => server.close(() => done()));
  });

  /** A recorder in front of a server whose Initiate answers `secret` with `status`. */
  async function recordingOf(secret: string, status = 200) {
    const upstream = createServer((incoming, outgoing) => {
      const isInitiate = incoming.url === "/QuickConnect/Initiate";
      const body = JSON.stringify(isInitiate ? { Secret: secret, Code: CODE } : { Authenticated: false });
      outgoing.writeHead(isInitiate ? status : 200, { "content-type": "application/json", "content-length": String(body.length), connection: "close" });
      outgoing.end(body);
    });
    servers.push(upstream);
    await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
    const address = upstream.address();
    if (address === null || typeof address === "string") throw new Error("the upstream has no port");
    const secrets = new Set<string>();
    const recorder = await startRecorder({ upstream: { port: address.port }, secrets });
    closers.push(recorder.close);
    const send = async (method: string, path: string) => {
      const response = await fetch(`http://127.0.0.1:${recorder.port}${path}`, { method, headers: { Authorization: 'MediaBrowser Client="Octave", Token=""' } });
      await response.text();
    };
    await send("POST", "/QuickConnect/Initiate");
    const judged = () => judgeRecords(recorder.records, { host: `127.0.0.1:${recorder.port}`, secrets: [...secrets] });
    return { secrets, send, judged, records: recorder.records };
  }

  it.each([
    ["an uppercase", UPPER],
    ["a lowercase", LOWER],
  ])("learns %s secret from Initiate, passes its poll, and fails a logcat line that holds it", async (_name, secret) => {
    const run = await recordingOf(secret);

    await run.send("GET", `${POLL}?secret=${secret}`);

    expect([...run.secrets]).toEqual([secret]);
    expect(run.records.at(-1)).toMatchObject({ path: POLL, queryNames: ["secret"], secretInUrl: false });
    expect(run.judged()).toEqual([]);
    const logcat = [`11-26 10:00:00.000  100  100 I ReactNativeJS: polling with ${secret}`];
    expect(judgeLogcat(logcat, [...run.secrets])).toEqual(["ERROR wire logcat: line 1 holds a known secret"]);
  });

  it.each([
    ["another request's query", `/Items?secret=${UPPER}`],
    ["another request's path", `/Items/${UPPER}`],
    ["the poll's other parameter", `${POLL}?deviceId=${UPPER}`],
    ["a query name", `${POLL}?${UPPER}=1`],
  ])("fails the secret in %s", async (_name, path) => {
    const run = await recordingOf(UPPER);

    await run.send("GET", path);

    expect(run.judged().join("\n")).toContain("holds a known secret in its URL");
    expect(JSON.stringify(run.records)).not.toContain(UPPER);
  });

  it("learns nothing from an Initiate the server refused", async () => {
    const run = await recordingOf(UPPER, 401);

    expect([...run.secrets]).toEqual([]);
  });
});

describe("T4-03 item 3: the recorder learns the secret and the token from compressed answers", () => {
  const closers: Array<() => Promise<unknown>> = [];
  afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
  });

  /** A recorder in front of a server that gzips its JSON when asked, as Jellyfin does. */
  async function compressedRecording() {
    const answers: Record<string, unknown> = {
      "/QuickConnect/Initiate": { Secret: UPPER, Code: CODE },
      "/Users/AuthenticateWithQuickConnect": { AccessToken: TOKEN },
    };
    const upstream = createServer((incoming, outgoing) => {
      const plain = Buffer.from(JSON.stringify(answers[incoming.url ?? ""] ?? {}));
      const wantsGzip = String(incoming.headers["accept-encoding"] ?? "").includes("gzip");
      const body = wantsGzip ? gzipSync(plain) : plain;
      const encoding: Record<string, string> = wantsGzip ? { "content-encoding": "gzip" } : {};
      outgoing.writeHead(200, { "content-type": "application/json", "content-length": String(body.length), connection: "close", ...encoding });
      outgoing.end(body);
    });
    await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
    closers.push(() => new Promise((done) => upstream.close(done)));
    const address = upstream.address();
    if (address === null || typeof address === "string") throw new Error("the upstream has no port");
    const secrets = new Set<string>();
    const recorder = await startRecorder({ upstream: { port: address.port }, secrets });
    closers.push(recorder.close);
    // node:http, unlike fetch, leaves the answer compressed, so the relayed encoding can be read.
    const post = (path: string) =>
      new Promise<string | undefined>((resolve, reject) => {
        const sent = request({ host: "127.0.0.1", port: recorder.port, method: "POST", path, headers: { "accept-encoding": "gzip" } }, (answer) => {
          answer.resume();
          answer.on("end", () => resolve(answer.headers["content-encoding"]));
        });
        sent.on("error", reject);
        sent.end();
      });
    return { secrets, post, records: recorder.records };
  }

  it("learns both values and relays the answer still compressed", async () => {
    const run = await compressedRecording();

    expect(await run.post("/QuickConnect/Initiate")).toBe("gzip");
    await run.post("/Users/AuthenticateWithQuickConnect");

    expect([...run.secrets]).toEqual([UPPER, TOKEN]);
    expect(run.records.map((record) => record.learned)).toEqual([true, true]);
  });

  it("fails a logcat line that holds the token the Quick Connect sign-in issued", async () => {
    const run = await compressedRecording();

    await run.post("/Users/AuthenticateWithQuickConnect");

    const logcat = [`11-26 10:00:00.000  100  100 I ReactNativeJS: signed in with ${TOKEN}`];
    expect(judgeLogcat(logcat, [...run.secrets])).toEqual(["ERROR wire logcat: line 1 holds a known secret"]);
  });
});
