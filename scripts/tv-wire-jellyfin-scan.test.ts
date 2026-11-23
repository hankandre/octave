// @vitest-environment node
// T8-07 (Product Owner ruling on item 6): the wire runner scans the Jellyfin library a selected test reads, before the
// first pair runs. A fake fetch stands in for the fixture server: no scan for a Jellyscale pair, a scan and a wait for
// jellyfin-12, and a plain failure when the samples never appear. The token never reaches a message.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCAN_LIMIT_MS, scanJellyfinLibraries, scanTargetsOf } from "./tv-wire-fixtures.mjs";

const TOKEN = "fake-scan-token-0123456789";
const CREDENTIALS = {
  "jellyfin-12_url": "http://127.0.0.1:18097",
  "jellyfin-12_username": "octave-admin",
  "jellyfin-12_password": "fixture-password",
  jellyscale_url: "http://127.0.0.1:18098",
  jellyscale_username: "octave-admin",
  jellyscale_password: "fixture-password",
};
const SAMPLES = [
  { Type: "Movie", Name: "Synthetic H264 (2024)", Path: "/media/movies/Synthetic H264 (2024)/Synthetic H264 (2024).mkv" },
  { Type: "Movie", Name: "Synthetic No Decoder (2024)", Path: "/media/movies/Synthetic No Decoder (2024)/Synthetic No Decoder (2024).mkv" },
];

type Call = { method: string; url: string; authorization: string };

// A fake Jellyfin: `itemsAfter` polls before the samples are listed (Infinity: never), `busyPolls` polls with a task running.
function fakeServer({ itemsAfter = 0, busyPolls = 0 } = {}) {
  const calls: Call[] = [];
  let polls = 0;
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const fetch = async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({ method: init.method ?? "GET", url, authorization: headers.Authorization });
    const path = new URL(url).pathname;
    if (path === "/Users/AuthenticateByName") return json({ AccessToken: TOKEN });
    if (path === "/Library/Refresh" || path === "/Sessions/Logout") return new Response(null, { status: 204 });
    if (path === "/ScheduledTasks") {
      polls += 1;
      return json([{ Key: "RefreshLibrary", State: polls <= busyPolls ? "Running" : "Idle" }]);
    }
    if (path === "/Items") return json({ Items: polls > itemsAfter ? SAMPLES : [] });
    return new Response(null, { status: 404 });
  };
  return { calls, fetch };
}

function clock() {
  let time = 0;
  return { now: () => time, sleep: async (ms: number) => void (time += ms) };
}

describe("T8-07: the wire runner's Jellyfin library scan", () => {
  it("starts no scan for a Jellyscale or mock pair, or a test that reads no Jellyfin library", async () => {
    const server = fakeServer();
    const pairs = [
      { test: "player-capabilities", target: "jellyscale" },
      { test: "player-capabilities", target: "mock" },
      { test: "player-original-file", target: "jellyfin-12" },
    ];
    expect(scanTargetsOf(pairs)).toEqual([]);
    await scanJellyfinLibraries(pairs, { credentials: CREDENTIALS, secrets: new Set(), fetch: server.fetch, ...clock(), log: () => {} });
    expect(server.calls).toEqual([]);
  });

  it("scans jellyfin-12 at the fixture's own origin and waits for both samples and idle tasks", async () => {
    const server = fakeServer({ itemsAfter: 2, busyPolls: 3 });
    const secrets = new Set<string>();
    const lines: string[] = [];
    await scanJellyfinLibraries([{ test: "player-capabilities", target: "jellyfin-12" }, { test: "player-capabilities", target: "jellyscale" }], {
      credentials: CREDENTIALS,
      secrets,
      fetch: server.fetch,
      ...clock(),
      log: (line: string) => void lines.push(line),
    });
    const sent = server.calls.map((call) => `${call.method} ${new URL(call.url).pathname}`);
    expect(sent[0]).toBe("POST /Users/AuthenticateByName");
    expect(sent[1]).toBe("POST /Library/Refresh");
    expect(sent.at(-1)).toBe("POST /Sessions/Logout");
    expect(sent.filter((line) => line === "GET /ScheduledTasks")).toHaveLength(5);
    expect(server.calls.every((call) => call.url.startsWith("http://127.0.0.1:18097/"))).toBe(true);
    expect(server.calls.slice(1).every((call) => call.authorization.endsWith(`Token="${TOKEN}"`))).toBe(true);
    expect(secrets.has(TOKEN)).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines.join("\n")).not.toContain(TOKEN);
  });

  it("fails with a plain line when the samples never appear within the limit", async () => {
    const server = fakeServer({ itemsAfter: Infinity });
    const time = clock();
    const failure = scanJellyfinLibraries([{ test: "player-capabilities", target: "jellyfin-12" }], {
      credentials: CREDENTIALS,
      secrets: new Set(),
      fetch: server.fetch,
      ...time,
      log: () => {},
    });
    await expect(failure).rejects.toThrow("jellyfin-12's library scan did not settle in 120 s (0 of 2 samples listed, 0 scheduled task(s) busy)");
    await failure.catch((error: Error) => expect(error.message).not.toContain(TOKEN));
    expect(time.now()).toBeGreaterThanOrEqual(SCAN_LIMIT_MS);
    expect(server.calls.at(-1)?.url).toBe("http://127.0.0.1:18097/Sessions/Logout");
  });

  it("is called by tv-wire.mjs after ensureFixtures and before the first pair, with the run's secrets", () => {
    const source = readFileSync(new URL("./tv-wire.mjs", import.meta.url), "utf8");
    const ensure = source.indexOf("await ensureFixtures(");
    const scan = source.indexOf("await scanJellyfinLibraries(selected, { credentials, secrets })");
    const firstPair = source.indexOf("for (const pair of selected) {");
    expect(ensure).toBeGreaterThan(0);
    expect(scan).toBeGreaterThan(ensure);
    expect(firstPair).toBeGreaterThan(scan);
  });
});
