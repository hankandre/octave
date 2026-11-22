import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeHome, HOME_LISTS, loadHomeLists } from "../domain/home";
import { webCrypto } from "../adapters/web-crypto";
import { FakeTransport } from "./fake-transport";
import { toRecentlyAdded } from "./cards";
import { JellyfinGateway } from "./gateway";

// T5-02 items 1, 2, 3, 4, 7 and 8: Home's recordings, replayed through the gateway on a fake transport.
// This import of ../domain/home stays at the top: it is the missing module that keeps the listing, parse and scrub
// cases red as well.
//
// What the servers answered (recorded by tests/integration/record-home-fixtures.mjs on 2026-11-22; the implementer
// copies this into the fixture READMEs, the research note and ARCHITECTURE.md section 3):
//
// - Jellyfin 10.11.7 and 12.4.0 answer GET /Items/Latest with no parentId as a bare array across both libraries
//   (Movies registered first, then Shows): 9 films and the show once, as a Series with ChildCount 3, in
//   home-latest.json. D5 holds: with includeItemTypes=Movie,Episode both versions still group the episodes
//   (home-latest-no-types.json is the same answer), so the parameter stays on the request.
// - groupItems=false (home-latest-ungrouped.json) gives the show's three episodes as loose Episode items that carry
//   SeriesId and SeriesName, 12 items in all. That is the shape of case (c) in home-latest-gateway.test.ts.
// - The three home-latest* files were recorded first, on a user with no watch state, so no "hide played in Latest"
//   setting can have changed them. The scene was set after: the H.264 film in progress (1 June 2026), the Multitrack
//   film in progress (2 June), S01E01 finished (3 June), so Resume holds the two films, Next Up holds S01E02 and
//   recently played holds S01E01 (home-resume, home-nextup and home-recently-played).
// - Newest first: 10.11.7 sorts the grouped answer by DateCreated, newest first. 12.4.0 does too for the films, but
//   it puts the grouped Series second although its own DateCreated is 30 ms newer than the first film's, so only
//   the series' place is out of date order there. The client keeps the server's order and sorts nothing.
// - Jellyscale (pin b920b193cd6f) answers 200 with a bare array of 14 for the same request: 11 films and the show's
//   three episodes as loose Episode items with SeriesId and no SeriesName, first (newest). groupItems and
//   includeItemTypes change nothing (home-latest-no-types.json is the same answer).
// - Jellyscale's Next Up stub (#101) answers 200 with {"Items":[],"TotalRecordCount":0,"StartIndex":0}, so nextUp()
//   resolves to no cards. It is not a rejection. Its recently-played answer is the same empty 200, so the plays
//   list is complete and empty. Its Resume answer holds the H.264 film with the saved position.
// - The Jellyscale files are recorded by a .mjs recorder that cannot import the frozen TypeScript one, so their fake
//   ids are consistent among the five home-* files only, not with latest-*.json.
const fixturesRoot = join(__dirname, "../../tests/fixtures");
const composePath = join(__dirname, "../../../../tests/integration/docker-compose.yml");
const ORIGIN = "http://127.0.0.1:8096";
const NOW = Date.parse("2026-06-20T12:00:00Z");

function pinFolder(): string {
  const sha = /^x-jellyscale-commit:\s*([0-9a-f]{40})\b/m.exec(readFileSync(composePath, "utf8"))?.[1];
  if (!sha) throw new Error("docker-compose.yml has no x-jellyscale-commit of 40 hex characters");
  return sha.slice(0, 12);
}

interface Server {
  label: string;
  folder: string;
  dir: string;
}

const JELLYFIN: Server[] = [
  { label: "Jellyfin 10.11.7", folder: "10.11.7", dir: join(fixturesRoot, "jellyfin", "10.11.7") },
  { label: "Jellyfin 12.4.0", folder: "12.4.0", dir: join(fixturesRoot, "jellyfin", "12.4.0") },
];
const JELLYSCALE: Server = { label: "Jellyscale", folder: pinFolder(), dir: join(fixturesRoot, "jellyscale", pinFolder()) };

const JELLYFIN_FILES = ["home-latest-no-types.json", "home-latest-ungrouped.json", "home-latest.json", "home-nextup.json", "home-recently-played.json", "home-resume.json"];
const JELLYSCALE_FILES = ["home-latest-no-types.json", "home-latest.json", "home-nextup.json", "home-recently-played.json", "home-resume.json"];

const load = (server: Server, file: string): any => JSON.parse(readFileSync(join(server.dir, file), "utf8"));

// A file saved as { httpStatus: n } is a non-2xx answer, replayed as that status.
function answer(server: Server, file: string): { body?: unknown; status?: number } {
  const saved = load(server, file);
  if (saved !== null && typeof saved === "object" && !Array.isArray(saved) && "httpStatus" in saved) return { status: Number(saved.httpStatus) };
  return { body: saved };
}

const ROUTES = { latest: "GET /Items/Latest", resume: "GET /UserItems/Resume", nextUp: "GET /Shows/NextUp", recentlyPlayed: "GET /Items" } as const;

async function replay(server: Server) {
  const transport = new FakeTransport();
  transport.responses.set("POST /Users/AuthenticateByName", { AccessToken: "REDACTED", User: { Id: "user-test", Name: "octave-test" } });
  const files: Record<keyof typeof ROUTES, string> = { latest: "home-latest.json", resume: "home-resume.json", nextUp: "home-nextup.json", recentlyPlayed: "home-recently-played.json" };
  for (const [name, route] of Object.entries(ROUTES)) {
    const { body, status } = answer(server, files[name as keyof typeof ROUTES]);
    if (status !== undefined) transport.statuses.set(route, status);
    else transport.responses.set(route, body);
  }
  const gateway = new JellyfinGateway(ORIGIN, webCrypto, transport, "install-1");
  await gateway.login("octave-test", "not-a-real-password");
  return { gateway, transport };
}

const ids = (cards: { id: string }[]) => cards.map((card) => card.id);
const homeOf = async (server: Server) => {
  const { gateway } = await replay(server);
  const { lists, failed } = await loadHomeLists(gateway, HOME_LISTS);
  return { lists, failed, home: composeHome(lists, { window: "all", now: NOW }) };
};

describe.each(JELLYFIN)("Home recordings, $label", (server) => {
  it("T5-02 item 1: gives the order the scene set: the next episode (series played 3 June), then the films of 2 and 1 June", async () => {
    const { failed, home } = await homeOf(server);
    expect(failed).toEqual([]);
    expect(home.hero).toMatchObject({ rule: "row", card: { id: "item-episode-2" } });
    expect(ids(home.continueWatching)).toEqual(["item-multitrack", "item-h264"]);
  });

  it("T5-02 item 2: maps the cross-library answer to the films and the show in one list, in the recorded order", async () => {
    const { gateway } = await replay(server);
    const cards = await gateway.latestItems();
    expect(cards).toHaveLength(10);
    expect(cards.filter((card) => card.kind === "Movie")).toHaveLength(9);
    expect(cards.filter((card) => card.kind === "Series")).toHaveLength(1);
    expect(ids(cards)).toEqual(load(server, "home-latest.json").map((item: { Id: string }) => item.Id));
  });

  it("T5-02 item 3: shows the synthetic show once, as the series, and no episode", async () => {
    const { gateway } = await replay(server);
    const cards = await gateway.latestItems();
    expect(cards.filter((card) => card.id === "series-synthetic")).toHaveLength(1);
    expect(cards.find((card) => card.id === "series-synthetic")).toMatchObject({ kind: "Series", title: "Synthetic Show" });
    expect(cards.some((card) => card.kind === "Episode")).toBe(false);
  });

  it("T5-02 item 3: still shows the show once when the ungrouped evidence is mapped", async () => {
    // Evidence only: the answer a request without grouping gets, three loose episodes of one show.
    const cards = toRecentlyAdded(load(server, "home-latest-ungrouped.json"), 15);
    expect(cards.filter((card) => card.id === "series-synthetic")).toHaveLength(1);
    expect(cards.some((card) => card.kind === "Episode")).toBe(false);
    expect(cards.filter((card) => card.kind === "Movie")).toHaveLength(9);
  });
});

describe("Home recordings, Jellyscale", () => {
  it("T5-02 item 4: maps the cross-library answer to the 11 films only, and no card for the three episodes or their series", async () => {
    const { gateway } = await replay(JELLYSCALE);
    const recorded = load(JELLYSCALE, "home-latest.json") as { Id: string; Type: string; SeriesId?: string }[];
    const episodes = recorded.filter((item) => item.Type === "Episode");
    expect(episodes).toHaveLength(3);
    const cards = await gateway.latestItems();
    expect(cards).toHaveLength(11);
    expect(cards.every((card) => card.kind === "Movie")).toBe(true);
    const left = new Set([...episodes.map((item) => item.Id), ...episodes.map((item) => item.SeriesId)]);
    expect(cards.some((card) => left.has(card.id))).toBe(false);
    // The films keep the recorded order.
    expect(ids(cards)).toEqual(recorded.filter((item) => item.Type === "Movie").map((item) => item.Id));
  });

  it("T5-02 item 7: shows the in-progress film when Next Up is the recorded stub, and the hero is that film", async () => {
    const { gateway } = await replay(JELLYSCALE);
    // The stub is a 200 with no items: nextUp() resolves to no cards (it does not reject).
    expect(await gateway.nextUp()).toEqual([]);
    const { failed, home } = await homeOf(JELLYSCALE);
    expect(failed).toEqual([]);
    expect(home.hero).toMatchObject({ rule: "row", card: { id: "item-h264" } });
    expect(home.continueWatching).toEqual([]);
  });
});

function folders(): [Server, string[]][] {
  return [...JELLYFIN.map((server): [Server, string[]] => [server, JELLYFIN_FILES]), [JELLYSCALE, JELLYSCALE_FILES]];
}

describe("T5-02 item 8: the Home recordings", () => {
  for (const [server, expected] of folders()) {
    it(`T5-02 item 8: ${server.label} holds exactly its home-* files`, () => {
      expect(existsSync(server.dir)).toBe(true);
      expect(readdirSync(server.dir).filter((name) => name.startsWith("home-")).sort()).toEqual(expected);
    });

    it(`T5-02 item 8: every ${server.label} file parses and passes the scrub rules`, () => {
      for (const file of expected) {
        const text = readFileSync(join(server.dir, file), "utf8");
        expect(() => JSON.parse(text), file).not.toThrow();
        expect(text, file).not.toMatch(/127\.0\.0\.1|localhost|:1809\d\b/);
        expect(text, file).not.toMatch(/"Path"\s*:/);
        expect(text, file).not.toMatch(/\b[0-9a-f]{32}\b/i);
        expect(text, file).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
        for (const match of text.matchAll(/(?:ApiKey|api_key|ApiToken|AccessToken|access_token|X-Emby-Token|Token)=([^&"\s]*)/gi)) expect(match[1], file).toBe("REDACTED");
        for (const match of text.matchAll(/"AccessToken":\s*"([^"]*)"/g)) expect(match[1], file).toBe("REDACTED");
      }
    });

    it(`T5-02 item 8: ${server.label} replays through the gateway with the counts it recorded, and a file saved as a status rejects`, async () => {
      const { gateway } = await replay(server);
      const jellyscale = server === JELLYSCALE;
      // Counts read from the recordings: Jellyfin 10 titles (9 films and the show), Jellyscale 14 items of which 11 are films.
      const cases: [string, () => Promise<unknown>, number][] = [
        ["home-latest.json", async () => (await gateway.latestItems()).length, jellyscale ? 11 : 10],
        ["home-resume.json", async () => (await gateway.resumeItems()).length, jellyscale ? 1 : 2],
        ["home-nextup.json", async () => (await gateway.nextUp()).length, jellyscale ? 0 : 1],
        ["home-recently-played.json", async () => (await gateway.recentlyPlayed()).entries.length, jellyscale ? 0 : 1],
      ];
      for (const [file, call, count] of cases) {
        if (answer(server, file).status !== undefined) await expect(call(), file).rejects.toBeDefined();
        else expect(await call(), file).toBe(count);
      }
      if (answer(server, "home-recently-played.json").status === undefined) expect((await gateway.recentlyPlayed()).complete).toBe(true);
    });
  }
});
