// @vitest-environment node
// T3-05 acceptance item 9, the pure half of wire test transport-private-lan-and-proxy (docs/specs/T3-05.md, row 9 and
// "The wire runner"). The device half (the line `transport-private-lan-and-proxy mock T3-05 pass` in
// release-evidence/wire/summary.txt) is item 7's evidence.
//
// The contract frozen here:
// - The mock's private-LAN origin counts the requests whose Host is exactly 10.0.2.2:<P>, and the runner puts that
//   count on the pair as `privateLan`. `requests` is the pair's recorder count alone; the direct request is not in it.
// - The app writes `OCTAVE_WIRE result test=transport-private-lan-and-proxy target=mock task=T3-05 probe=<word>`:
//   probe=ok when the direct probe answered 200, probe=bad-address when privateLanProbeTarget returned null (nothing is
//   sent), probe=<code> otherwise.
// - scripts/tv-wire-judge.mjs: judgeWire (and WIRE_JUDGES["transport-private-lan-and-proxy"]) fails the pair when
//   privateLan is absent or below 1, or when the line does not say probe=ok.
// - apps/tv/src/e2e/wire/private-lan-address.ts: privateLanProbeTarget(value) returns the address when value is exactly
//   `http://10.0.2.2:<port>` with a port in 1..65535, and null otherwise.
// - Under apps/tv/src/, only e2e/wire/transport-private-lan-and-proxy.ts holds the text `LocalAddress`.
//
// Causes are matched with loose patterns, not exact messages. Modules that later milestones create are loaded at run
// time from a path built here, so `pnpm typecheck` does not depend on them existing.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const appSrc = join(repo, "apps", "tv", "src");

type WirePair = {
  test: string;
  target: string;
  task: string;
  requests: number;
  redirector?: number;
  canaryOrigin?: number;
  privateLan?: number;
};
type WireRun = { pairs: WirePair[]; lines: string[] };
type JudgeModule = {
  judgeWire: (run: WireRun) => string[];
  WIRE_JUDGES: Record<string, unknown>;
};
type ProbeTarget = (value: unknown) => unknown;

async function load<T>(path: string): Promise<T> {
  return (await import(pathToFileURL(join(repo, path)).href)) as T;
}

const loadJudge = () => load<JudgeModule>("scripts/tv-wire-judge.mjs");
const loadProbeTarget = async () =>
  (await load<{ privateLanProbeTarget: ProbeTarget }>("apps/tv/src/e2e/wire/private-lan-address.ts")).privateLanProbeTarget;

const PAIR: WirePair = { test: "transport-private-lan-and-proxy", target: "mock", task: "T3-05", requests: 1, privateLan: 1 };
const LINE = "OCTAVE_WIRE result test=transport-private-lan-and-proxy target=mock task=T3-05 probe=ok";
const DONE = "OCTAVE_WIRE done";

const REDIRECT_PAIR: WirePair = { test: "transport-redirect", target: "mock", task: "T3-05", requests: 1, redirector: 1, canaryOrigin: 0 };
const REDIRECT_LINE = "OCTAVE_WIRE result test=transport-redirect target=mock task=T3-05 code=redirect gateway=redirect";
const CANARY_PAIR: WirePair = { test: "transport-canary", target: "mock", task: "T3-05", requests: 6, canaryOrigin: 0 };
const CANARY_LINE = "OCTAVE_WIRE result test=transport-canary target=mock task=T3-05 crossings=64 selftest=ok canary=absent";

// The cause, matched after test ids are removed, so that naming the pair (transport-private-lan-and-proxy) or another
// one (transport-redirect) is not taken for naming the private-LAN request.
const PRIVATE_LAN_CAUSE = /private[- ]?lan|10\.0\.2\.2|\bdirect\b/i;
const causes = (errors: string[]) => errors.join("\n").replace(/transport-[a-z0-9-]+/g, "");

async function judge(pair: WirePair, line: string): Promise<string[]> {
  return (await loadJudge()).judgeWire({ pairs: [pair], lines: [line, DONE] });
}

function withoutPrivateLan(pair: WirePair): WirePair {
  const { privateLan: _dropped, ...rest } = pair;
  return rest;
}

describe("T3-05 item 9: judgeWire holds transport-private-lan-and-proxy to a direct plain-HTTP request the mock recorded", () => {
  // (a)
  it("passes a pair whose private-LAN origin counted the request, with probe=ok", async () => {
    expect(await judge(PAIR, LINE)).toEqual([]);
  });

  it("has a host judge for the test", async () => {
    const { WIRE_JUDGES } = await loadJudge();
    expect(typeof WIRE_JUDGES["transport-private-lan-and-proxy"]).toBe("function");
  });

  // (b) the capture without that request
  it("fails, naming the private-LAN request, when the private-LAN origin counted none, although the app says probe=ok", async () => {
    for (const requests of [1, 2]) {
      const errors = await judge({ ...PAIR, requests, privateLan: 0 }, LINE);
      expect(errors.length, `requests=${requests}`).toBeGreaterThan(0);
      expect(causes(errors), `requests=${requests}`).toMatch(PRIVATE_LAN_CAUSE);
    }
  });

  it("fails, naming the private-LAN request, when the pair carries no privateLan count at all", async () => {
    for (const requests of [1, 2]) {
      const errors = await judge(withoutPrivateLan({ ...PAIR, requests }), LINE);
      expect(errors.length, `requests=${requests}`).toBeGreaterThan(0);
      expect(causes(errors), `requests=${requests}`).toMatch(PRIVATE_LAN_CAUSE);
    }
  });

  // (c)
  it("fails when the app's line does not say probe=ok, even with the request counted", async () => {
    for (const word of ["probe=refused", "probe=bad-address", "probe=500", "probe=network"]) {
      const errors = await judge(PAIR, LINE.replace("probe=ok", word));
      expect(errors.length, word).toBeGreaterThan(0);
      expect(errors.join("\n"), word).toMatch(/probe|bad-address|refused/i);
    }
    expect((await judge(PAIR, LINE.replace(" probe=ok", ""))).length).toBeGreaterThan(0);
  });

  // (d)
  it("still passes the redirect and canary pairs beside a passing private-LAN pair", async () => {
    const { judgeWire } = await loadJudge();
    const errors = judgeWire({
      pairs: [REDIRECT_PAIR, CANARY_PAIR, PAIR],
      lines: [REDIRECT_LINE, CANARY_LINE, LINE, DONE],
    });
    expect(errors).toEqual([]);
  });

  it("does not pass this pair on a privateLan count carried by another pair", async () => {
    const { judgeWire } = await loadJudge();
    for (const mine of [{ ...PAIR, privateLan: 0 }, withoutPrivateLan(PAIR)]) {
      const errors = judgeWire({
        pairs: [{ ...REDIRECT_PAIR, privateLan: 1 }, { ...CANARY_PAIR, privateLan: 3 }, mine],
        lines: [REDIRECT_LINE, CANARY_LINE, LINE, DONE],
      });
      expect(errors.length, JSON.stringify(mine)).toBeGreaterThan(0);
      expect(causes(errors), JSON.stringify(mine)).toMatch(PRIVATE_LAN_CAUSE);
      expect(errors.some((error) => error.includes("transport-private-lan-and-proxy")), JSON.stringify(mine)).toBe(true);
      expect(errors.join("\n")).not.toMatch(/redirector|crossing|self-?test/i);
    }
  });
});

describe("T3-05 item 9: privateLanProbeTarget accepts only http://10.0.2.2:<port>", () => {
  // (e)
  it("returns the address for http://10.0.2.2 with a port", async () => {
    const privateLanProbeTarget = await loadProbeTarget();
    for (const address of ["http://10.0.2.2:18233", "http://10.0.2.2:1", "http://10.0.2.2:65535"]) {
      const result = privateLanProbeTarget(address);
      expect(result, address).not.toBeNull();
      expect(result, address).not.toBeUndefined();
      expect(String(result).replace(/\/$/, ""), address).toBe(address);
    }
  });

  it("returns null for any other host", async () => {
    const privateLanProbeTarget = await loadProbeTarget();
    for (const value of [
      "http://127.0.0.1:18233",
      "http://10.0.2.3:18233",
      "http://10.0.2.2.example.com:18233",
      "http://192.168.1.10:18233",
      "http://8.8.8.8:18233",
      "http://203.0.113.7:18233",
      "http://example.com:18233",
      "http://localhost:18233",
      "http://[::1]:18233",
    ]) {
      expect(privateLanProbeTarget(value), value).toBeNull();
    }
  });

  it("returns null for https, user info, a path, a query, no port, port 0 and a port above 65535", async () => {
    const privateLanProbeTarget = await loadProbeTarget();
    for (const value of [
      "https://10.0.2.2:18233",
      "http://user:pass@10.0.2.2:18233",
      "http://user@10.0.2.2:18233",
      "http://10.0.2.2:18233/System/Info/Public",
      "http://10.0.2.2:18233/x",
      "http://10.0.2.2:18233?x=1",
      "http://10.0.2.2:18233/?x=1",
      "http://10.0.2.2",
      "http://10.0.2.2:",
      "http://10.0.2.2:0",
      "http://10.0.2.2:65536",
      "http://10.0.2.2:99999",
      "",
    ]) {
      expect(privateLanProbeTarget(value), value).toBeNull();
    }
  });

  it("returns null for a value that is not a string", async () => {
    const privateLanProbeTarget = await loadProbeTarget();
    for (const value of [undefined, null, 18233, true, {}, [], ["http://10.0.2.2:18233"], new URL("http://10.0.2.2:18233")]) {
      expect(privateLanProbeTarget(value), String(value)).toBeNull();
    }
  });
});

describe("T3-05 item 9: only the device file follows the LocalAddress field", () => {
  // (f)
  function filesUnder(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...filesUnder(path));
      else if (entry.isFile()) out.push(path);
    }
    return out;
  }

  it("names LocalAddress in apps/tv/src/e2e/wire/transport-private-lan-and-proxy.ts and in no other file under apps/tv/src", () => {
    const holders = filesUnder(appSrc)
      .filter((path) => readFileSync(path, "utf8").includes("LocalAddress"))
      .map((path) => relative(appSrc, path).split(sep).join("/"))
      .sort();
    expect(holders).toEqual(["e2e/wire/transport-private-lan-and-proxy.ts"]);
  });
});
