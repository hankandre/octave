import { describe, expect, it } from "vitest";
import { webCrypto } from "../adapters/web-crypto";
import { composeHome, HOME_LISTS, loadHomeLists, type HomeListName } from "../domain/home";
import { TransportError } from "../ports/transport";
import { FakeTransport } from "./fake-transport";
import { JellyfinGateway } from "./gateway";

// T5-02 items 6 and 7: loadHomeLists against the real gateway on a fake transport. It starts every named list at once,
// reports the ones that failed by name (D7) and sends only reads.
const NOW = Date.parse("2026-06-20T12:00:00Z");

const film = (id: string, lastPlayedAt: string) => ({
  Id: id, Name: `Film ${id}`, Type: "Movie", RunTimeTicks: 1_000_000_000,
  UserData: { PlaybackPositionTicks: 100_000_000, Played: false, LastPlayedDate: lastPlayedAt },
});
const nextEpisode = { Id: "next-1", Name: "Pilot", Type: "Episode", SeriesId: "series-1", SeriesName: "Show", ParentIndexNumber: 1, IndexNumber: 1, UserData: { PlaybackPositionTicks: 0, Played: false } };
const latestFilm = { Id: "new-1", Name: "New film", Type: "Movie", UserData: { PlaybackPositionTicks: 0, Played: false } };
const finished = { Id: "done-1", Name: "Done", Type: "Movie", UserData: { PlaybackPositionTicks: 0, Played: true, LastPlayedDate: "2026-06-10T12:00:00Z" } };

const ROUTES: Record<HomeListName, string> = {
  resume: "GET /UserItems/Resume",
  nextUp: "GET /Shows/NextUp",
  recentlyPlayed: "GET /Items",
  recentlyAdded: "GET /Items/Latest",
};

async function signedIn() {
  const transport = new FakeTransport();
  transport.responses.set("POST /Users/AuthenticateByName", { AccessToken: "token-1", User: { Id: "user-1", Name: "Louise" } });
  transport.responses.set(ROUTES.resume, { Items: [film("film-a", "2026-06-02T12:00:00Z"), film("film-b", "2026-06-01T12:00:00Z")] });
  transport.responses.set(ROUTES.nextUp, { Items: [nextEpisode] });
  transport.responses.set(ROUTES.recentlyPlayed, { Items: [finished] });
  transport.responses.set(ROUTES.recentlyAdded, [latestFilm]);
  const gateway = new JellyfinGateway("https://media.test", webCrypto, transport, "install-1");
  await gateway.login("Louise", "password");
  return { gateway, transport };
}

describe("loadHomeLists, the requests", () => {
  it("T5-02 item 6: sends exactly four GET requests for one load and no write", async () => {
    const { gateway, transport } = await signedIn();
    await loadHomeLists(gateway, HOME_LISTS);
    expect(transport.requests.map((request) => `${request.method} ${request.url}`).sort()).toEqual(
      [ROUTES.resume, ROUTES.nextUp, ROUTES.recentlyPlayed, ROUTES.recentlyAdded].sort(),
    );
    expect(transport.requests.every((request) => request.method === "GET")).toBe(true);
  });

  it("T5-02 item 6: asks each list for the fields it pins, and recently played for none", async () => {
    const { gateway, transport } = await signedIn();
    await loadHomeLists(gateway, HOME_LISTS);
    const params = (key: string) => transport.requests.find((request) => `${request.method} ${request.url}` === key)?.params ?? {};
    expect(params(ROUTES.resume).fields).toBe("PrimaryImageAspectRatio");
    expect(params(ROUTES.recentlyAdded).fields).toBe("PrimaryImageAspectRatio");
    // The one stated exception (Product Owner ruling, D9): Next Up keeps DateCreated, the window rule's input, until
    // the owner decides the window (T5-01). Every other Home request asks for card fields only.
    expect(params(ROUTES.nextUp).fields).toBe("PrimaryImageAspectRatio,DateCreated");
    expect(params(ROUTES.recentlyPlayed)).not.toHaveProperty("fields");
  });

  it("T5-02 item 6: sends one request when it loads one list", async () => {
    const { gateway, transport } = await signedIn();
    const { lists, failed } = await loadHomeLists(gateway, ["nextUp"]);
    expect(transport.requests.map((request) => `${request.method} ${request.url}`)).toEqual([ROUTES.nextUp]);
    expect(failed).toEqual([]);
    expect(Object.keys(lists)).toEqual(["nextUp"]);
  });

  it("T5-02 item 6: gives every list on a good load, with the cards the gateway maps", async () => {
    const { gateway } = await signedIn();
    const { lists, failed } = await loadHomeLists(gateway, HOME_LISTS);
    expect(failed).toEqual([]);
    expect(lists.resume?.map((card) => card.id)).toEqual(["film-a", "film-b"]);
    expect(lists.nextUp?.map((card) => card.id)).toEqual(["next-1"]);
    expect(lists.recentlyAdded?.map((card) => card.id)).toEqual(["new-1"]);
    expect(lists.recentlyPlayed?.entries.map((entry) => entry.id)).toEqual(["done-1"]);
  });
});

describe("loadHomeLists, a list that fails", () => {
  it.each(HOME_LISTS.map((name) => [name]))("T5-02 item 6: names %s alone when it answers 500, and the other three still arrive", async (name) => {
    const { gateway, transport } = await signedIn();
    transport.statuses.set(ROUTES[name as HomeListName], 500);
    const { lists, failed } = await loadHomeLists(gateway, HOME_LISTS);
    expect(failed.map((failure) => failure.list)).toEqual([name]);
    const error = failed[0]?.error as TransportError;
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ code: "status", status: 500 });
    expect(lists).not.toHaveProperty(name as string);
    expect(Object.keys(lists).sort()).toEqual(HOME_LISTS.filter((other) => other !== name).sort());
  });

  it("T5-02 item 6: reports a transport failure the same way", async () => {
    const { gateway, transport } = await signedIn();
    transport.failures.set(ROUTES.resume, new TransportError("network"));
    const { lists, failed } = await loadHomeLists(gateway, HOME_LISTS);
    expect(failed.map((failure) => failure.list)).toEqual(["resume"]);
    expect(failed[0]?.error).toMatchObject({ code: "network" });
    expect(lists).not.toHaveProperty("resume");
  });

  it("T5-02 item 6: reports a status of 0 and a 302 as failed lists too", async () => {
    for (const status of [0, 302]) {
      const { gateway, transport } = await signedIn();
      transport.statuses.set(ROUTES.recentlyAdded, status);
      const { lists, failed } = await loadHomeLists(gateway, HOME_LISTS);
      expect(failed.map((failure) => failure.list), `status ${status}`).toEqual(["recentlyAdded"]);
      expect(failed[0]?.error, `status ${status}`).toBeInstanceOf(Error);
      expect(lists, `status ${status}`).not.toHaveProperty("recentlyAdded");
      expect(lists.resume, `status ${status}`).toBeDefined();
    }
  });

  it("T5-02 item 6: lists several failures in the order of the names it was given", async () => {
    const { gateway, transport } = await signedIn();
    transport.statuses.set(ROUTES.resume, 500);
    transport.statuses.set(ROUTES.recentlyAdded, 503);
    const { failed } = await loadHomeLists(gateway, ["recentlyAdded", "nextUp", "resume"]);
    expect(failed.map((failure) => failure.list)).toEqual(["recentlyAdded", "resume"]);
  });

  it("T5-02 item 6: rejects with the abort reason, and reports no failed list, when the signal is aborted", async () => {
    const { gateway, transport } = await signedIn();
    transport.statuses.set(ROUTES.nextUp, 500);
    const controller = new AbortController();
    const reason = new Error("stopped by the screen");
    controller.abort(reason);
    await expect(loadHomeLists(gateway, HOME_LISTS, controller.signal)).rejects.toBe(reason);
  });

  it("T5-02 item 6: retries one list by itself and recomposes the same Home from the merged lists", async () => {
    const { gateway, transport } = await signedIn();
    transport.statuses.set(ROUTES.nextUp, 500);
    const first = await loadHomeLists(gateway, HOME_LISTS);
    expect(first.failed.map((failure) => failure.list)).toEqual(["nextUp"]);
    transport.statuses.delete(ROUTES.nextUp);
    transport.requests.length = 0;
    const retry = await loadHomeLists(gateway, ["nextUp"]);
    expect(transport.requests.map((request) => `${request.method} ${request.url}`)).toEqual([ROUTES.nextUp]);
    const merged = { ...first.lists, ...retry.lists };
    expect(retry.failed).toEqual([]);
    expect(merged.nextUp?.map((card) => card.id)).toEqual(["next-1"]);
    expect(composeHome(merged, { window: "all", now: NOW }).hero).toMatchObject({ rule: "row" });
  });
});

describe("loadHomeLists, a server whose Next Up is a stub", () => {
  it.each([404, 501])("T5-02 item 7: keeps the Resume titles in the row and names nextUp as failed when Next Up answers %i", async (status) => {
    const { gateway, transport } = await signedIn();
    transport.statuses.set(ROUTES.nextUp, status);
    const { lists, failed } = await loadHomeLists(gateway, HOME_LISTS);
    expect(failed.map((failure) => failure.list)).toEqual(["nextUp"]);
    expect(failed[0]?.error).toMatchObject({ code: "status", status });
    const home = composeHome(lists, { window: "all", now: NOW });
    // film-a was played last, so it is the hero; film-b stays in the row beneath it.
    expect(home.hero).toMatchObject({ rule: "row", card: { id: "film-a" } });
    expect(home.continueWatching.map((card) => card.id)).toEqual(["film-b"]);
  });

  it("T5-02 item 7: builds the row without the recently-played list when that list fails, next episodes after the dated titles", async () => {
    const { gateway, transport } = await signedIn();
    transport.statuses.set(ROUTES.recentlyPlayed, 500);
    const { lists, failed } = await loadHomeLists(gateway, HOME_LISTS);
    expect(failed.map((failure) => failure.list)).toEqual(["recentlyPlayed"]);
    const home = composeHome(lists, { window: "all", now: NOW });
    expect(home.hero).toMatchObject({ rule: "row", card: { id: "film-a" } });
    expect(home.continueWatching.map((card) => card.id)).toEqual(["film-b", "next-1"]);
  });
});
