import { describe, expect, it } from "vitest";
import type { MediaCard } from "./catalog";
import { composeHome } from "./home";
import type { PlayedEntry, RecentPlays } from "./up-next";

// T5-02 items 1 and 5: composeHome turns the four lists into Continue watching, Recently added and the hero.
// It is pure; the window and the clock are arguments (D1). Items 1 and 5 are about composeHome, so no case here
// calls continueWatchingRow or pickUpNext on its own.
const DAY = 86_400_000;
const NOW = Date.parse("2026-06-20T12:00:00Z");
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

const film = (id: string, lastPlayedAt?: string): MediaCard => ({
  id, kind: "Movie", title: id, aspectRatio: 2 / 3, resumePositionTicks: 100, ...(lastPlayedAt ? { lastPlayedAt } : {}),
});
const episode = (id: string, seriesId: string, lastPlayedAt?: string): MediaCard => ({
  id, kind: "Episode", title: seriesId, aspectRatio: 16 / 9, seriesId, ...(lastPlayedAt ? { lastPlayedAt } : {}),
});
const added = (id: string, kind: "Movie" | "Series" = "Movie"): MediaCard => ({ id, kind, title: id, aspectRatio: 2 / 3 });
const entry = (id: string, playedAt: string, seriesId?: string): PlayedEntry => ({
  id, kind: seriesId ? "Episode" : "Movie", playedAt, ...(seriesId ? { seriesId } : {}),
});
const plays = (entries: PlayedEntry[], complete = true): RecentPlays => ({ entries, complete });
const ids = (cards: MediaCard[]) => cards.map((card) => card.id);
const heroId = (home: ReturnType<typeof composeHome>) => (home.hero.rule === "none" ? undefined : home.hero.card.id);
// Every title of the row, the hero included: the hero is taken out of the row beneath it (D3).
const wholeRow = (home: ReturnType<typeof composeHome>) => (home.hero.rule === "row" ? [home.hero.card.id, ...ids(home.continueWatching)] : ids(home.continueWatching));

describe("composeHome, Continue watching", () => {
  it("T5-02 item 1: puts an in-progress film, an in-progress episode and a next episode in last-play order", () => {
    const home = composeHome({
      // Listed oldest first on purpose: Resume's own order is not the answer.
      resume: [film("film-old", ago(5)), episode("episode-now", "series-a", ago(1))],
      // The next episode has no date of its own: its series' last finished play (3 days ago) dates it.
      nextUp: [episode("next-b", "series-b")],
      recentlyPlayed: plays([entry("done-b1", ago(3), "series-b")]),
    }, { window: "all", now: NOW });
    expect(wholeRow(home)).toEqual(["episode-now", "next-b", "film-old"]);
  });

  it("T5-02 item 1: gives at most 20 cards for 24 titles, the hero included", () => {
    const resume = Array.from({ length: 24 }, (_, index) => film(`f${index}`, ago(index + 1)));
    const home = composeHome({ resume }, { window: "all", now: NOW });
    expect(wholeRow(home)).toEqual(Array.from({ length: 20 }, (_, index) => `f${index}`));
    expect(home.continueWatching).toHaveLength(19);
  });

  it("T5-02 item 1: puts a next episode with no known play after the dated titles", () => {
    const home = composeHome({
      resume: [film("film-a", ago(30))],
      nextUp: [episode("next-unknown", "series-x")],
      recentlyPlayed: plays([]),
    }, { window: "all", now: NOW });
    expect(wholeRow(home)).toEqual(["film-a", "next-unknown"]);
  });

  it("T5-02 item 1: builds the row without the recently-played list when it is missing", () => {
    const home = composeHome({
      resume: [film("film-a", ago(30))],
      nextUp: [episode("next-unknown", "series-x")],
    }, { window: "all", now: NOW });
    expect(wholeRow(home)).toEqual(["film-a", "next-unknown"]);
  });

  it("T5-02 item 1: keeps a title played a year ago with window all", () => {
    const home = composeHome({ resume: [film("film-year", ago(365))] }, { window: "all", now: NOW });
    expect(wholeRow(home)).toEqual(["film-year"]);
  });

  it("T5-02 item 1: applies the window the caller passes, not a default of its own", () => {
    const lists = { resume: [film("film-year", ago(365)), film("film-recent", ago(2))] };
    expect(wholeRow(composeHome(lists, { window: "all", now: NOW }))).toEqual(["film-recent", "film-year"]);
    expect(wholeRow(composeHome(lists, { window: "30", now: NOW }))).toEqual(["film-recent"]);
  });

  it("T5-02 item 1: treats a missing list as empty", () => {
    expect(composeHome({}, { window: "all", now: NOW })).toEqual({ hero: { rule: "none" }, continueWatching: [], recentlyAdded: [] });
  });
});

describe("composeHome, the hero and the row beneath it", () => {
  it("T5-02 item 5: takes the first Continue watching title as the hero, drops it from that row and leaves Recently added untouched", () => {
    const recentlyAdded = [added("new-1"), added("new-2")];
    const home = composeHome({
      resume: [film("first", ago(1)), film("second", ago(2))],
      recentlyAdded,
    }, { window: "all", now: NOW });
    expect(home.hero).toMatchObject({ rule: "row", card: { id: "first" } });
    expect(ids(home.continueWatching)).toEqual(["second"]);
    expect(home.recentlyAdded).toEqual(recentlyAdded);
  });

  it("T5-02 item 5: leaves Recently added untouched when it holds the hero's id and Continue watching keeps another card", () => {
    const home = composeHome({
      resume: [film("first", ago(1)), film("second", ago(2))],
      recentlyAdded: [added("new-1"), added("first")],
    }, { window: "all", now: NOW });
    expect(heroId(home)).toBe("first");
    expect(ids(home.recentlyAdded)).toEqual(["new-1", "first"]);
  });

  it("T5-02 item 5: takes the first Recently added title as the hero when Continue watching is empty, and drops it from that row", () => {
    const home = composeHome({
      recentlyAdded: [added("show-1", "Series"), added("film-1"), added("film-2")],
    }, { window: "all", now: NOW });
    expect(home.hero).toMatchObject({ rule: "newest", card: { id: "show-1", kind: "Series" } });
    expect(home.continueWatching).toEqual([]);
    expect(ids(home.recentlyAdded)).toEqual(["film-1", "film-2"]);
  });

  it("T5-02 item 5: shows at most 14 more Recently added titles under a hero taken from it, with no slot refilled", () => {
    const recentlyAdded = Array.from({ length: 15 }, (_, index) => added(`new-${index}`));
    const home = composeHome({ recentlyAdded }, { window: "all", now: NOW });
    expect(heroId(home)).toBe("new-0");
    expect(ids(home.recentlyAdded)).toEqual(recentlyAdded.slice(1).map((card) => card.id));
    expect(home.recentlyAdded).toHaveLength(14);
  });

  it("T5-02 item 5: also drops the hero's id from Recently added when Continue watching holds only the hero", () => {
    // Recently added is then the row below the hero. The match is by card id and the id goes wherever it sits.
    const home = composeHome({
      resume: [film("only", ago(1))],
      recentlyAdded: [added("new-1"), added("new-2"), added("only"), added("new-3")],
    }, { window: "all", now: NOW });
    expect(home.hero).toMatchObject({ rule: "row", card: { id: "only" } });
    expect(home.continueWatching).toEqual([]);
    expect(ids(home.recentlyAdded)).toEqual(["new-1", "new-2", "new-3"]);
  });

  it("T5-02 item 5: keeps an episode hero's series card in Recently added, because the ids differ", () => {
    const home = composeHome({
      resume: [episode("episode-1", "series-a", ago(1))],
      recentlyAdded: [added("series-a", "Series"), added("new-1")],
    }, { window: "all", now: NOW });
    expect(heroId(home)).toBe("episode-1");
    expect(home.continueWatching).toEqual([]);
    expect(ids(home.recentlyAdded)).toEqual(["series-a", "new-1"]);
  });

  it("T5-02 item 5: has no hero when both rows are empty", () => {
    const home = composeHome({ resume: [], nextUp: [], recentlyAdded: [] }, { window: "all", now: NOW });
    expect(home.hero).toEqual({ rule: "none" });
    expect(home.continueWatching).toEqual([]);
    expect(home.recentlyAdded).toEqual([]);
  });

  it("T5-02 item 5: picks no sequel or similar title after a finished film, only the two rules of the row and the newest addition", () => {
    const finishedFilm = entry("film-done", ago(1));
    const withFinished = composeHome({
      recentlyPlayed: plays([finishedFilm]),
      recentlyAdded: [added("new-1"), added("new-2")],
    }, { window: "all", now: NOW });
    const without = composeHome({ recentlyAdded: [added("new-1"), added("new-2")] }, { window: "all", now: NOW });
    expect(withFinished).toEqual(without);
    expect(withFinished.hero).toMatchObject({ rule: "newest", card: { id: "new-1" } });
  });
});
