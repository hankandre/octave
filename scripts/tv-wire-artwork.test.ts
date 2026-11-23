// @vitest-environment node
// T3-11 items 2 to 7, the host half of the artwork wire tests (docs/specs/T3-11.md, "The wire tests"; spec check issues
// 5 and 6). The device half, the same judges on a real run of `pnpm tv:wire --task T3-11`, is item 7's gate:
// release-evidence/wire/summary.txt from CI's wire job on the pull request's head.
//
// The contract frozen here, beside T3-05's (scripts/tv-wire.test.ts) and T8-02's (scripts/tv-wire-player.test.ts):
// - apps/tv/src/e2e/wire/wire-tests.json lists artwork-header-and-cache (mock, jellyfin-10-11, jellyfin-12, jellyscale)
//   and artwork-canary (mock), each once with task "T3-11", a device file apps/tv/src/e2e/wire/<id>.ts that
//   run-wire.ts names, and a WIRE_JUDGES entry. Every pair's device port stays below canaryPort.
// - scripts/tv-wire-judge.mjs exports judgeArtworkCapture(records, { host, secrets, images, widths }) -> ERROR lines.
//   `images` is k, the count the app's line names; `widths` is the maxWidth of each image request the mock recorded
//   (the recorder keeps query names only), given for the mock and undefined for a real server. It fails unless:
//   - judgeRecords passes (the MediaBrowser header on every request, a token after sign-in, no secret in a URL, the
//     recorder's Host, no 3xx);
//   - the requests other than images are exactly GET /System/Info/Public, POST /Users/AuthenticateByName,
//     GET /Items/Latest and POST /Sessions/Logout, in that order;
//   - k >= 1 and there are exactly k image requests, each a GET of /Items/{id}/Images/Primary whose query names are
//     exactly tag, maxWidth, quality and format, with k distinct paths, all after /Items/Latest and before the logout.
//     A repeat of an image request is allowed only right after a 503 with Retry-After: 0 (OkHttp's own, as
//     judgeCapture allows); any other repeat fails, so a second visit that reaches the server fails;
//   - when `widths` is given it is not empty and every value is 248.
// - WIRE_JUDGES["artwork-header-and-cache"](pair, said) needs outcome=ok, images=k with k >= 1, and first and second
//   both k/k.
// - WIRE_JUDGES["artwork-canary"](pair, said) needs canary=absent, selftest=ok, viewProps >= 24, events >= 24 and
//   failed >= 1.
// - judgeRun (scripts/tv-wire.mjs) judges each artwork-header-and-cache pair with judgeArtworkCapture, taking k from
//   the pair's result line and the widths from the run pair's `widths` (the mock's record), and artwork-canary with
//   judgeRecords; its summary line is "<test> <target> T3-11 pass|fail".
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const wireDir = join(repo, "apps", "tv", "src", "e2e", "wire");

type WireRecord = {
  method: string;
  path: string;
  queryNames: string[];
  authorization: boolean;
  scheme: string | null;
  token: boolean;
  host: string;
  status: number | null;
  retryAfter: string | null;
  secretInUrl: boolean;
  range: boolean;
  staticTrue: boolean;
};
type Pair = { test: string; target: string; task: string; requests: number; canaryOrigin?: number };
type Judge = (pair: Pair, said: Record<string, string>) => string[];
type CaptureOptions = { host: string; secrets: string[]; images: number; widths?: number[] };
type JudgeModule = {
  judgeArtworkCapture: (records: WireRecord[], options: CaptureOptions) => string[];
  WIRE_JUDGES: Record<string, Judge>;
};
type RunPair = { test: string; target: string; task: string; devicePort: number; records: WireRecord[]; widths?: number[] };
type RunInput = {
  pairs: RunPair[];
  counts: { canaryOrigin: number; redirector: number; privateLan: number };
  lines: string[];
  logLines: string[];
  seen: { method: string; target: string; host: string }[];
  devicePorts: number[];
  secrets: string[];
  voids: string[];
  kept: { how: string; lines: number; start: boolean; end: boolean; open: boolean };
  deviceLines: string[];
};
type RunnerModule = {
  judgeRun: (input: RunInput, deps: { write: (evidence: unknown) => string[] }) => { summary: string[]; errors: string[]; failed: boolean };
  selectTests: (options: { task?: string }) => { id: string; task: string; targets: string[] }[];
  pairsOf: () => { test: string; target: string; task: string; devicePort: number }[];
};

const load = async <T>(path: string) => (await import(pathToFileURL(join(repo, path)).href)) as T;
const loadJudge = () => load<JudgeModule>("scripts/tv-wire-judge.mjs");
const loadRunner = () => load<RunnerModule>("scripts/tv-wire.mjs");

const PORT = 47311;
const HOST = `127.0.0.1:${PORT}`;
const TOKEN = "tok/7c1e+3a9b=5d0f";
const ITEMS = ["a1b2c3d4e5f60718293a4b5c6d7e8f90", "b2c3d4e5f60718293a4b5c6d7e8f90a1", "c3d4e5f60718293a4b5c6d7e8f90a1b2"];
const IMAGE_QUERY = ["tag", "maxWidth", "quality", "format"];
const GOOD_LINE = "outcome=ok images=3 first=3/3 second=3/3";
const CANARY_LINE = "crossings=40 viewProps=60 events=24 failed=1 selftest=ok canary=absent";

function rec(method: string, path: string, extra: Partial<WireRecord> = {}): WireRecord {
  const tokenless = path === "/System/Info/Public" || path === "/Users/AuthenticateByName";
  return {
    method,
    path,
    queryNames: [],
    authorization: true,
    scheme: "MediaBrowser",
    token: !tokenless,
    host: HOST,
    status: 200,
    retryAfter: null,
    secretInUrl: false,
    range: false,
    staticTrue: false,
    ...extra,
  };
}

const image = (itemId: string, extra: Partial<WireRecord> = {}) => rec("GET", `/Items/${itemId}/Images/Primary`, { queryNames: [...IMAGE_QUERY], ...extra });

// Connect, sign in, the latest items, one image per card on the first mount, none on the second, and the logout.
function artworkCapture(): WireRecord[] {
  return [
    rec("GET", "/System/Info/Public"),
    rec("POST", "/Users/AuthenticateByName"),
    rec("GET", "/Items/Latest", { queryNames: ["userId", "limit", "groupItems", "includeItemTypes", "enableUserData", "fields", "enableImageTypes", "imageTypeLimit"] }),
    ...ITEMS.map((itemId) => image(itemId)),
    rec("POST", "/Sessions/Logout"),
  ];
}

const options = (extra: Partial<CaptureOptions> = {}): CaptureOptions => ({ host: HOST, secrets: [TOKEN], images: 3, ...extra });

function withRecord(records: WireRecord[], index: number, change: Partial<WireRecord>): WireRecord[] {
  const copy = records.map((r) => ({ ...r }));
  copy[index] = { ...copy[index], ...change };
  return copy;
}

function insertAt(records: WireRecord[], index: number, ...added: WireRecord[]): WireRecord[] {
  return [...records.slice(0, index), ...added, ...records.slice(index)];
}

function wireList(): { canaryPort: number; tests: { id: string; task: string; targets: string[] }[] } {
  return JSON.parse(readFileSync(join(wireDir, "wire-tests.json"), "utf8")) as { canaryPort: number; tests: { id: string; task: string; targets: string[] }[] };
}

function expectEntry(id: string, targets: string[]) {
  const entries = wireList().tests.filter((entry) => entry.id === id);
  expect(entries, `wire-tests.json lists ${id} once`).toHaveLength(1);
  expect(entries[0].task).toBe("T3-11");
  expect(entries[0].targets).toEqual(targets);
  expect(existsSync(join(wireDir, `${id}.ts`)), `apps/tv/src/e2e/wire/${id}.ts exists`).toBe(true);
  const runWire = readFileSync(join(wireDir, "run-wire.ts"), "utf8");
  expect(runWire, `run-wire.ts names ${id} in TESTS`).toContain(`"${id}"`);
}

async function judgeOf(id: string): Promise<Judge> {
  const judge = (await loadJudge()).WIRE_JUDGES[id];
  expect(typeof judge, `WIRE_JUDGES has ${id}`).toBe("function");
  return judge;
}

const words = (line: string) => Object.fromEntries([...line.matchAll(/(\S+?)=(\S*)/g)].map(([, key, value]) => [key, value]));

function runInput(test: string, target: string, records: WireRecord[], line: string, extra: Partial<RunPair> = {}): RunInput {
  return {
    pairs: [{ test, target, task: "T3-11", devicePort: PORT, records, ...extra }],
    counts: { canaryOrigin: 0, redirector: 0, privateLan: 0 },
    lines: [`OCTAVE_WIRE result test=${test} target=${target} task=T3-11 ${line}`, "OCTAVE_WIRE done"],
    logLines: ["01-01 00:00:00.000  1  1 I ReactNativeJS: fine"],
    seen: [],
    devicePorts: [PORT],
    secrets: [TOKEN],
    voids: [],
    kept: { how: "stream", lines: 900, start: true, end: true, open: true },
    deviceLines: [],
  };
}

// ---- the list ----

describe("T3-11 item 7: the two artwork wire tests are listed under T3-11", () => {
  it("T3-11 item 7: artwork-header-and-cache runs on the mock and the three pinned servers, Jellyscale included", async () => {
    expectEntry("artwork-header-and-cache", ["mock", "jellyfin-10-11", "jellyfin-12", "jellyscale"]);
    await judgeOf("artwork-header-and-cache");
  });

  it("T3-11 item 6: artwork-canary runs on the mock", async () => {
    expectEntry("artwork-canary", ["mock"]);
    await judgeOf("artwork-canary");
  });

  it("T3-11 item 7: --task T3-11 selects exactly the two, and every device port stays below canaryPort", async () => {
    const { selectTests, pairsOf } = await loadRunner();
    expect(selectTests({ task: "T3-11" }).map((entry) => entry.id).sort()).toEqual(["artwork-canary", "artwork-header-and-cache"]);
    const { canaryPort } = wireList();
    for (const pair of pairsOf()) expect(pair.devicePort, `${pair.test} ${pair.target}`).toBeLessThan(canaryPort);
  });
});

// ---- items 2, 3 and 4: the capture ----

describe("T3-11 items 2 to 4: judgeArtworkCapture", () => {
  it("T3-11 item 2: a good capture passes, on the mock with every width 248 and on a real server with none", async () => {
    const { judgeArtworkCapture } = await loadJudge();
    expect(judgeArtworkCapture(artworkCapture(), options({ widths: [248, 248, 248] }))).toEqual([]);
    expect(judgeArtworkCapture(artworkCapture(), options())).toEqual([]);
  });

  it("T3-11 item 2: an image request without the header or without the token fails", async () => {
    const { judgeArtworkCapture } = await loadJudge();
    expect(judgeArtworkCapture(withRecord(artworkCapture(), 4, { authorization: false, scheme: null, token: false }), options()).length).toBeGreaterThan(0);
    expect(judgeArtworkCapture(withRecord(artworkCapture(), 4, { token: false }), options()).length).toBeGreaterThan(0);
    expect(judgeArtworkCapture(withRecord(artworkCapture(), 4, { scheme: "Bearer" }), options()).length).toBeGreaterThan(0);
  });

  it("T3-11 item 2: an image URL that holds a secret or a credential query name fails, and a relayed redirect fails", async () => {
    const { judgeArtworkCapture } = await loadJudge();
    expect(judgeArtworkCapture(withRecord(artworkCapture(), 4, { secretInUrl: true }), options()).length).toBeGreaterThan(0);
    expect(judgeArtworkCapture(withRecord(artworkCapture(), 4, { queryNames: [...IMAGE_QUERY, "api_key"] }), options()).length).toBeGreaterThan(0);
    expect(judgeArtworkCapture(withRecord(artworkCapture(), 4, { status: 302 }), options()).length).toBeGreaterThan(0);
  });

  it("T3-11 item 4: a fourth image request among three cards fails, as a repeat of one already loaded", async () => {
    const { judgeArtworkCapture } = await loadJudge();
    const records = artworkCapture();
    const repeated = insertAt(records, 6, image(ITEMS[2]));
    expect(judgeArtworkCapture(repeated, options()).length, "a repeat right after the first").toBeGreaterThan(0);
    const secondVisit = insertAt(records, 6, image(ITEMS[0]));
    expect(judgeArtworkCapture(secondVisit, options()).length, "a second visit that reached the server").toBeGreaterThan(0);
  });

  it("T3-11 item 4: a repeat right after a 503 with Retry-After: 0 is allowed, as judgeCapture allows it", async () => {
    const { judgeArtworkCapture } = await loadJudge();
    const records = artworkCapture();
    const retried = [...records.slice(0, 3), image(ITEMS[0], { status: 503, retryAfter: "0" }), ...records.slice(3)];
    expect(judgeArtworkCapture(retried, options())).toEqual([]);
    const notRetryable = [...records.slice(0, 3), image(ITEMS[0], { status: 503, retryAfter: "5" }), ...records.slice(3)];
    expect(judgeArtworkCapture(notRetryable, options()).length).toBeGreaterThan(0);
  });

  it("T3-11 item 4: fewer image requests than the cards the app named fails", async () => {
    const { judgeArtworkCapture } = await loadJudge();
    const records = artworkCapture().filter((record) => !record.path.endsWith(`${ITEMS[1]}/Images/Primary`));
    expect(judgeArtworkCapture(records, options()).length).toBeGreaterThan(0);
  });

  it("T3-11 item 2: an image request after the logout, or before the latest items, fails", async () => {
    const { judgeArtworkCapture } = await loadJudge();
    const records = artworkCapture();
    const after = [...records.slice(0, 5), records[6], records[5]];
    expect(judgeArtworkCapture(after, options()).length, "after the logout").toBeGreaterThan(0);
    const before = [records[0], records[1], records[3], records[2], ...records.slice(4)];
    expect(judgeArtworkCapture(before, options()).length, "before /Items/Latest").toBeGreaterThan(0);
  });

  it("T3-11 item 2: a missing or extra call other than images fails", async () => {
    const { judgeArtworkCapture } = await loadJudge();
    const records = artworkCapture();
    expect(judgeArtworkCapture(records.slice(0, 6), options()).length, "no logout").toBeGreaterThan(0);
    expect(judgeArtworkCapture(insertAt(records, 3, rec("GET", "/UserViews")), options()).length, "an extra call").toBeGreaterThan(0);
  });

  it("T3-11 item 3: a wrong query-name set fails", async () => {
    const { judgeArtworkCapture } = await loadJudge();
    for (const names of [["tag", "maxWidth", "quality"], ["tag", "quality", "format"], [...IMAGE_QUERY, "maxHeight"], ["tag", "width", "quality", "format"]]) {
      expect(judgeArtworkCapture(withRecord(artworkCapture(), 4, { queryNames: names }), options()).length, names.join(",")).toBeGreaterThan(0);
    }
  });

  it("T3-11 item 2: an image request that is not a GET of a Primary fails", async () => {
    const { judgeArtworkCapture } = await loadJudge();
    expect(judgeArtworkCapture(withRecord(artworkCapture(), 4, { path: `/Items/${ITEMS[0]}/Images/Backdrop` }), options()).length).toBeGreaterThan(0);
    expect(judgeArtworkCapture(withRecord(artworkCapture(), 4, { method: "POST" }), options()).length).toBeGreaterThan(0);
  });

  it("T3-11 item 4: images=0 fails, even with a capture that holds no image", async () => {
    const { judgeArtworkCapture } = await loadJudge();
    const noImages = artworkCapture().filter((record) => !record.path.includes("/Images/"));
    expect(judgeArtworkCapture(noImages, options({ images: 0 })).length).toBeGreaterThan(0);
  });

  it("T3-11 item 3: on the mock, a width other than 248 fails, and so does no width at all", async () => {
    const { judgeArtworkCapture } = await loadJudge();
    expect(judgeArtworkCapture(artworkCapture(), options({ widths: [248, 600, 248] })).length).toBeGreaterThan(0);
    expect(judgeArtworkCapture(artworkCapture(), options({ widths: [400, 400, 400] })).length).toBeGreaterThan(0);
    expect(judgeArtworkCapture(artworkCapture(), options({ widths: [] })).length).toBeGreaterThan(0);
  });
});

describe("T3-11 item 4: the result line of artwork-header-and-cache", () => {
  it("T3-11 item 4: the judge needs outcome=ok, images of at least 1, and every card loaded on both visits", async () => {
    const judge = await judgeOf("artwork-header-and-cache");
    const pair: Pair = { test: "artwork-header-and-cache", target: "jellyscale", task: "T3-11", requests: 8 };
    expect(judge(pair, words(GOOD_LINE))).toEqual([]);
    expect(judge(pair, words("outcome=ok images=1 first=1/1 second=1/1"))).toEqual([]);
    for (const line of [
      "outcome=threw images=3 first=3/3 second=3/3",
      "outcome=ok images=3 first=3/3 second=2/3",
      "outcome=ok images=3 first=2/3 second=3/3",
      "outcome=ok images=3 first=3/3 second=3/4",
      "outcome=ok images=0 first=0/0 second=0/0",
      "outcome=ok images=3 first=3/3",
      "outcome=ok first=3/3 second=3/3",
    ]) {
      expect(judge(pair, words(line)).length, line).toBeGreaterThan(0);
    }
  });
});

// ---- item 6: the canary ----

describe("T3-11 item 6: the artwork canary's judge", () => {
  it("T3-11 item 6: a good line passes", async () => {
    const judge = await judgeOf("artwork-canary");
    const pair: Pair = { test: "artwork-canary", target: "mock", task: "T3-11", requests: 30, canaryOrigin: 0 };
    expect(judge(pair, words(CANARY_LINE))).toEqual([]);
    expect(judge(pair, words("crossings=24 viewProps=24 events=24 failed=1 selftest=ok canary=absent"))).toEqual([]);
  });

  it("T3-11 item 6: canary=present, a failed self-test, fewer than 24 view props or events, or no failed card fails", async () => {
    const judge = await judgeOf("artwork-canary");
    const pair: Pair = { test: "artwork-canary", target: "mock", task: "T3-11", requests: 30, canaryOrigin: 0 };
    for (const [key, wrong] of [
      ["canary", "present"],
      ["selftest", "fail"],
      ["viewProps", "23"],
      ["events", "23"],
      ["failed", "0"],
      ["viewProps", "many"],
    ]) {
      const said = { ...words(CANARY_LINE), [key]: wrong };
      expect(judge(pair, said).length, `${key}=${wrong}`).toBeGreaterThan(0);
    }
    for (const key of ["canary", "selftest", "viewProps", "events", "failed"]) {
      const said = words(CANARY_LINE);
      delete said[key];
      expect(judge(pair, said).length, `no ${key}`).toBeGreaterThan(0);
    }
  });
});

// ---- item 7: the whole run ----

describe("T3-11 item 7: judgeRun over an artwork run", () => {
  it("T3-11 item 7: a whole artwork-header-and-cache run passes on Jellyscale and on the mock", async () => {
    const { judgeRun } = await loadRunner();
    const jellyscale = judgeRun(runInput("artwork-header-and-cache", "jellyscale", artworkCapture(), GOOD_LINE), { write: () => [] });
    expect(jellyscale.errors).toEqual([]);
    expect(jellyscale.summary).toEqual(["artwork-header-and-cache jellyscale T3-11 pass"]);
    const mock = judgeRun(runInput("artwork-header-and-cache", "mock", artworkCapture(), GOOD_LINE, { widths: [248, 248, 248] }), { write: () => [] });
    expect(mock.errors).toEqual([]);
    expect(mock.summary).toEqual(["artwork-header-and-cache mock T3-11 pass"]);
  });

  it("T3-11 item 7: judgeRun fails a run with an image request without the header, a repeat, a mock width of 600 or second=2/3", async () => {
    const { judgeRun } = await loadRunner();
    const cases: [string, RunInput][] = [
      ["no header", runInput("artwork-header-and-cache", "jellyscale", withRecord(artworkCapture(), 4, { authorization: false, scheme: null, token: false }), GOOD_LINE)],
      ["a fourth image request", runInput("artwork-header-and-cache", "jellyscale", insertAt(artworkCapture(), 6, image(ITEMS[0])), GOOD_LINE)],
      ["a mock width of 600", runInput("artwork-header-and-cache", "mock", artworkCapture(), GOOD_LINE, { widths: [600, 600, 600] })],
      ["no mock widths", runInput("artwork-header-and-cache", "mock", artworkCapture(), GOOD_LINE)],
      ["second=2/3", runInput("artwork-header-and-cache", "jellyscale", artworkCapture(), "outcome=ok images=3 first=3/3 second=2/3")],
      ["images=2 against three requests", runInput("artwork-header-and-cache", "jellyscale", artworkCapture(), "outcome=ok images=2 first=2/2 second=2/2")],
    ];
    for (const [name, input] of cases) {
      const result = judgeRun(input, { write: () => [] });
      expect(result.failed, name).toBe(true);
      expect(result.summary[0], name).toMatch(/ T3-11 fail$/);
    }
  });

  it("T3-11 item 6: judgeRun fails an artwork-canary run whose logcat holds the token", async () => {
    const { judgeRun } = await loadRunner();
    const records = artworkCapture();
    const good = judgeRun(runInput("artwork-canary", "mock", records, CANARY_LINE), { write: () => [] });
    expect(good.errors).toEqual([]);
    expect(good.summary).toEqual(["artwork-canary mock T3-11 pass"]);
    const input = runInput("artwork-canary", "mock", records, CANARY_LINE);
    input.logLines = [`01-01 00:00:00.000  1  1 I ReactNativeJS: art ${TOKEN}`];
    expect(judgeRun(input, { write: () => [] }).failed).toBe(true);
  });
});
