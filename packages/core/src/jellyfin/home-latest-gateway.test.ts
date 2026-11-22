import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { webCrypto } from "../adapters/web-crypto";
import { toRecentlyAdded, toMediaCard } from "./cards";
import { FakeTransport } from "./fake-transport";
import { CONTROL_REQUEST_TIMEOUT_MS, JellyfinGateway, RECENTLY_ADDED_LIMIT } from "./gateway";
import { toQuery } from "./query";
import type { BaseItemDto } from "./types";

// T5-02 items 2, 3, 4 and 6: the cross-library Latest request (gateway.latestItems) and what Recently added keeps
// (toRecentlyAdded, D6). Every case calls one of the two, so each is red while they are missing.
//
// "Newest first" is the server's order: latestItems asks for no date field and the client does not sort, so these tests
// check that the answer's order is kept. The sort is Jellyfin's (Items/Latest is sorted by DateCreated descending in
// UserViewManager.GetLatestItems) and Jellyscale's (internal/api/items.go latestItems); the recordings in
// home-fixtures.test.ts hold it.
//
// Case (c) of item 3 uses the loose episode Jellyfin 12.4.0 recorded for groupItems=false (home-latest-ungrouped.json).
// Jellyfin answers a loose Episode for a show with exactly one new episode (UserLibraryController.GetLatestMedia: the
// series replaces its episodes only when two or more are new). The recorded DTO is read, never edited; the extra
// fields are spread over it inside the test.
const root = join(__dirname, "../../tests/fixtures");
const recorded = (path: string): BaseItemDto[] => JSON.parse(readFileSync(join(root, path), "utf8")) as BaseItemDto[];
const dto = (value: Record<string, unknown>) => value as BaseItemDto;

const movie = (id: string, extra: Record<string, unknown> = {}) => dto({ Id: id, Name: `Film ${id}`, Type: "Movie", ProductionYear: 2024, ...extra });
const series = (id: string, extra: Record<string, unknown> = {}) => dto({ Id: id, Name: `Show ${id}`, Type: "Series", ProductionYear: 2020, ChildCount: 8, ...extra });
const looseEpisode = (id: string, seriesId: string, extra: Record<string, unknown> = {}) =>
  dto({ Id: id, Name: `Episode ${id}`, Type: "Episode", SeriesId: seriesId, SeriesName: `Show ${seriesId}`, ParentIndexNumber: 1, IndexNumber: 2, ...extra });
const ids = (cards: { id: string }[]) => cards.map((card) => card.id);

async function signedIn(answer: unknown) {
  const transport = new FakeTransport();
  transport.responses.set("POST /Users/AuthenticateByName", { AccessToken: "token-1", User: { Id: "user-1", Name: "Louise" } });
  transport.responses.set("GET /Items/Latest", answer);
  const gateway = new JellyfinGateway("https://media.test", webCrypto, transport, "install-1");
  await gateway.login("Louise", "password");
  return { gateway, transport };
}

describe("gateway.latestItems, the request", () => {
  it("T5-02 item 2: sends one GET /Items/Latest with no parentId and a limit of 15", async () => {
    const { gateway, transport } = await signedIn([]);
    await gateway.latestItems();
    expect(RECENTLY_ADDED_LIMIT).toBe(15);
    expect(transport.requests).toHaveLength(1);
    const request = transport.requests[0]!;
    expect(request.method).toBe("GET");
    expect(request.url).toBe("/Items/Latest");
    expect(request.params).not.toHaveProperty("parentId");
    expect(request.params.limit).toBe("15");
    expect(request.timeout).toBe(CONTROL_REQUEST_TIMEOUT_MS);
  });

  it("T5-02 item 2: sends exactly these query pairs, in this order", async () => {
    const { gateway, transport } = await signedIn([]);
    await gateway.latestItems();
    expect(transport.requests[0]?.query).toEqual(toQuery({
      userId: "user-1",
      limit: 15,
      groupItems: true,
      includeItemTypes: "Movie,Episode",
      enableUserData: true,
      fields: "PrimaryImageAspectRatio",
      imageTypeLimit: 1,
      enableImageTypes: "Primary,Backdrop,Thumb,Logo",
    }));
  });

  it("T5-02 item 3: asks the server to group episodes", async () => {
    const { gateway, transport } = await signedIn([]);
    await gateway.latestItems();
    expect(transport.requests[0]?.params.groupItems).toBe("true");
  });

  it("T5-02 item 6: asks only for the card field PrimaryImageAspectRatio and no date field", async () => {
    const { gateway, transport } = await signedIn([]);
    await gateway.latestItems();
    const params = transport.requests[0]?.params ?? {};
    expect(params.fields).toBe("PrimaryImageAspectRatio");
    expect(params).toMatchObject({ imageTypeLimit: "1", enableImageTypes: "Primary,Backdrop,Thumb,Logo", enableUserData: "true" });
    expect(params).not.toHaveProperty("enableTotalRecordCount");
  });
});

describe("gateway.latestItems, the list", () => {
  it("T5-02 item 2: gives 15 cards for 20 answered items, in the order the server answered", async () => {
    const items = Array.from({ length: 20 }, (_, index) => movie(`m${index}`));
    const { gateway } = await signedIn(items);
    const cards = await gateway.latestItems();
    expect(ids(cards)).toEqual(Array.from({ length: 15 }, (_, index) => `m${index}`));
  });

  it("T5-02 item 2: keeps movies and shows together in the server's order", async () => {
    const { gateway } = await signedIn([movie("m1"), series("s1"), movie("m2")]);
    const cards = await gateway.latestItems();
    expect(cards.map((card) => [card.id, card.kind])).toEqual([["m1", "Movie"], ["s1", "Series"], ["m2", "Movie"]]);
  });

  it("T5-02 item 2: maps an answer that is not an array to an empty list", async () => {
    for (const answer of [undefined, null, {}, { Items: [movie("m1")] }, "no"]) {
      const { gateway } = await signedIn(answer);
      expect(await gateway.latestItems()).toEqual([]);
    }
  });

  it("T5-02 item 4: gives an empty list when every answered item is an episode without its series' name", async () => {
    const { gateway } = await signedIn([
      dto({ Id: "e1", Name: "Episode 1", Type: "Episode", SeriesId: "s1", ParentIndexNumber: 1, IndexNumber: 1 }),
      dto({ Id: "e2", Name: "Episode 2", Type: "Episode", SeriesId: "s1", ParentIndexNumber: 1, IndexNumber: 2 }),
    ]);
    expect(await gateway.latestItems()).toEqual([]);
  });
});

describe("toRecentlyAdded, D6", () => {
  it("T5-02 item 2: keeps a movie as the card toMediaCard gives it", () => {
    const item = movie("m1");
    expect(toRecentlyAdded([item], RECENTLY_ADDED_LIMIT)).toEqual([toMediaCard(item)]);
  });

  it("T5-02 item 2: cuts at the limit it is given", () => {
    const items = Array.from({ length: 20 }, (_, index) => movie(`m${index}`));
    expect(toRecentlyAdded(items, 15)).toHaveLength(15);
    expect(toRecentlyAdded(items, 3)).toHaveLength(3);
  });

  it("T5-02 item 2: leaves out every type that is not a movie, a show or an episode", () => {
    const cards = toRecentlyAdded([
      dto({ Id: "a1", Name: "Album", Type: "MusicAlbum" }),
      dto({ Id: "p1", Name: "Photo", Type: "Photo" }),
      dto({ Id: "b1", Name: "Collection", Type: "BoxSet" }),
      movie("m1"),
    ], 15);
    expect(ids(cards)).toEqual(["m1"]);
  });

  it("T5-02 item 3: gives one Series card for a series among films", () => {
    const cards = toRecentlyAdded([movie("m1"), series("s1", { ChildCount: 8 }), movie("m2")], 15);
    expect(cards.map((card) => [card.id, card.kind])).toEqual([["m1", "Movie"], ["s1", "Series"], ["m2", "Movie"]]);
  });

  it("T5-02 item 3: gives one card when the answer names the same series twice", () => {
    const cards = toRecentlyAdded([series("s1"), movie("m1"), series("s1")], 15);
    expect(ids(cards)).toEqual(["s1", "m1"]);
  });

  it("T5-02 item 3: shows a loose episode as its series, once, at the place of its newest episode", () => {
    const cards = toRecentlyAdded([
      movie("m1"),
      looseEpisode("e3", "s1", { IndexNumber: 3 }),
      movie("m2"),
      looseEpisode("e2", "s1", { IndexNumber: 2 }),
    ], 15);
    expect(cards.map((card) => [card.id, card.kind, card.title])).toEqual([
      ["m1", "Movie", "Film m1"],
      ["s1", "Series", "Show s1"],
      ["m2", "Movie", "Film m2"],
    ]);
  });

  it("T5-02 item 3: does not repeat a series that is already in the list, whichever came first", () => {
    expect(ids(toRecentlyAdded([series("s1"), looseEpisode("e1", "s1")], 15))).toEqual(["s1"]);
    expect(ids(toRecentlyAdded([looseEpisode("e1", "s1"), series("s1")], 15))).toEqual(["s1"]);
  });

  it("T5-02 item 3: builds the series card of a loose Jellyfin episode from the series, with none of the episode's own state", () => {
    const loose = recorded("jellyfin/12.4.0/home-latest-ungrouped.json").find((item) => item.Id === "item-episode-2");
    expect(loose?.Type).toBe("Episode");
    // The recorded show has no images, so these are added here. A half-watched, finished episode with a position.
    const episode = {
      ...loose,
      DateCreated: "2026-06-03T12:00:00Z",
      SeriesPrimaryImageTag: "series-poster-tag",
      ParentLogoItemId: "series-synthetic",
      ParentLogoImageTag: "series-logo-tag",
      ParentThumbItemId: "series-synthetic",
      ParentThumbImageTag: "series-thumb-tag",
      ParentBackdropItemId: "series-synthetic",
      ParentBackdropImageTags: ["series-backdrop-tag"],
      UserData: { PlaybackPositionTicks: 40_000_000, Played: true, PlayCount: 1, LastPlayedDate: "2026-06-03T12:00:00Z", UnplayedItemCount: 2, IsFavorite: false },
    } as BaseItemDto;
    const cards = toRecentlyAdded([episode], 15);
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card).toMatchObject({ id: "series-synthetic", kind: "Series", title: "Synthetic Show" });
    // The series poster, and the logo, thumb and parent backdrop the episode carries.
    expect(card.image).toEqual({ itemId: "series-synthetic", type: "Primary", tag: "series-poster-tag" });
    const viaEpisode = toMediaCard(episode)!;
    expect(card.logo).toEqual(viaEpisode.logo);
    expect(card.thumb).toEqual(viaEpisode.thumb);
    expect(card.parentBackdrop).toEqual(viaEpisode.parentBackdrop);
    expect(card.logo).toBeDefined();
    expect(card.thumb).toBeDefined();
    expect(card.parentBackdrop).toBeDefined();
    // None of the episode's own state or numbers, and no year or unplayed count.
    for (const key of ["played", "resumePositionTicks", "progress", "remainingTicks", "lastPlayedAt", "seasonNumber", "episodeNumber", "seriesId", "addedAt", "subtitle", "unplayedCount"]) {
      expect(card, key).not.toHaveProperty(key);
    }
  });

  it("T5-02 item 4: leaves out an episode that does not name its series, among films", () => {
    const cards = toRecentlyAdded([
      dto({ Id: "e1", Name: "Episode 1", Type: "Episode", SeriesId: "s1" }),
      movie("m1"),
      dto({ Id: "e2", Name: "Episode 2", Type: "Episode", SeriesId: "s1", SeriesName: null }),
      movie("m2"),
    ], 15);
    expect(ids(cards)).toEqual(["m1", "m2"]);
  });

  it("T5-02 item 4: gives an empty list for an answer of only such episodes, and none for the series they belong to", () => {
    const cards = toRecentlyAdded([
      dto({ Id: "e1", Name: "Episode 1", Type: "Episode", SeriesId: "s1" }),
      dto({ Id: "e2", Name: "Episode 2", Type: "Episode", SeriesId: "s1" }),
    ], 15);
    expect(cards).toEqual([]);
  });

  it("T5-02 item 2: gives an empty list for no items", () => {
    expect(toRecentlyAdded(undefined, 15)).toEqual([]);
    expect(toRecentlyAdded([], 15)).toEqual([]);
  });
});
