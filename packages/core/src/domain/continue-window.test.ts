import { describe, expect, it } from "vitest";
import type { MediaCard } from "./catalog";
import { composeHome } from "./home";
import { CONTINUE_ROW_LIMIT, CONTINUE_WINDOWS, DEFAULT_CONTINUE_WINDOW, type PlayedEntry, type RecentPlays } from "./up-next";

// T5-07 items 1 to 5: the Continue watching window and cap, through composeHome. Pure: `now` is an argument.
// The window values are the owner's: 30, 90, 180, 365 days or Never ("all"), and 90 days when none is set (D1, D2).
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-22T12:00:00Z");
const ago = (days: number, extraMs = 0) => new Date(NOW - days * DAY - extraMs).toISOString();

const film = (id: string, lastPlayedAt?: string): MediaCard => ({
  id, kind: "Movie", title: id, aspectRatio: 2 / 3, resumePositionTicks: 100, ...(lastPlayedAt ? { lastPlayedAt } : {}),
});
const next = (id: string, seriesId: string, addedAt?: string): MediaCard => ({
  id, kind: "Episode", title: seriesId, aspectRatio: 16 / 9, seriesId, ...(addedAt ? { addedAt } : {}),
});
const added = (id: string): MediaCard => ({ id, kind: "Movie", title: id, aspectRatio: 2 / 3 });
const finished = (id: string, playedAt: string, seriesId: string): PlayedEntry => ({ id, kind: "Episode", playedAt, seriesId });
const plays = (entries: PlayedEntry[], complete = true): RecentPlays => ({ entries, complete });
const ids = (cards: MediaCard[]) => cards.map((card) => card.id);
type Window = "30" | "90" | "180" | "365" | "all";
type Lists = Parameters<typeof composeHome>[0];
// Every title of the row, the hero included.
const compose = (lists: Lists, window: Window | string | number | undefined, now = NOW) => {
  const options = (window === undefined ? { now } : { window, now }) as Parameters<typeof composeHome>[1];
  const home = composeHome(lists, options);
  return { home, whole: home.hero.rule === "row" ? [home.hero.card.id, ...ids(home.continueWatching)] : ids(home.continueWatching) };
};

describe("Continue watching, the window as an input (item 1)", () => {
  it("T5-07 item 1: drops a film last played 91 days ago and keeps one played 89 days ago, with window 90", () => {
    const lists = { resume: [film("old", ago(91)), film("recent", ago(89))] };
    expect(compose(lists, "90").whole).toEqual(["recent"]);
  });

  it("T5-07 item 1: never makes the aged-out film the hero", () => {
    const { home } = compose({ resume: [film("old", ago(91))], recentlyAdded: [added("new-1")] }, "90");
    expect(home.hero).toMatchObject({ rule: "newest", card: { id: "new-1" } });
    expect(home.continueWatching).toEqual([]);
  });
});

describe("Continue watching, the window values (item 2)", () => {
  it("T5-07 item 2: lists exactly 30, 90, 180, 365 and all, in that order, and defaults to 90", () => {
    expect([...CONTINUE_WINDOWS]).toEqual(["30", "90", "180", "365", "all"]);
    expect(DEFAULT_CONTINUE_WINDOW).toBe("90");
  });

  it.each([30, 90, 180, 365])("T5-07 item 2: with window %i keeps a title played exactly that many days ago and drops one a millisecond older", (days) => {
    const lists = { resume: [film("on-the-line", ago(days)), film("too-old", ago(days, 1))] };
    expect(compose(lists, String(days)).whole).toEqual(["on-the-line"]);
  });

  it("T5-07 item 2: with all keeps a title played 1000 days ago", () => {
    expect(compose({ resume: [film("ancient", ago(1000))] }, "all").whole).toEqual(["ancient"]);
  });

  it("T5-07 item 2: reads an omitted window as 90 days", () => {
    const lists = { resume: [film("in", ago(89)), film("out", ago(91))] };
    expect(compose(lists, undefined).whole).toEqual(["in"]);
  });

  it.each(["7", "14", "", 5, null, "weekly"])("T5-07 item 2: reads the unknown window %j as 90 days", (value) => {
    const lists = { resume: [film("in", ago(89)), film("out", ago(91))] };
    expect(compose(lists, value as never).whole).toEqual(["in"]);
  });
});

describe("Continue watching, which date a card ages by (item 3)", () => {
  it("T5-07 item 3: (a) ages a next episode by its series' last finished play, not by its own missing date", () => {
    const lists = {
      nextUp: [next("next-in", "series-in"), next("next-out", "series-out")],
      recentlyPlayed: plays([finished("d1", ago(30), "series-in"), finished("d2", ago(100), "series-out")]),
    };
    expect(compose(lists, "90").whole).toEqual(["next-in"]);
    expect(compose(lists, "180").whole).toEqual(["next-in", "next-out"]);
  });

  it("T5-07 item 3: (b) keeps a next episode that arrived inside the window after the series' last play", () => {
    const lists = {
      nextUp: [next("new-episode", "series-a", ago(20))],
      recentlyPlayed: plays([finished("d1", ago(120), "series-a")]),
    };
    expect(compose(lists, "90").whole).toEqual(["new-episode"]);
  });

  it("T5-07 item 3: (b) drops that episode a window after it arrived", () => {
    const lists = {
      nextUp: [next("new-episode", "series-a", ago(91))],
      recentlyPlayed: plays([finished("d1", ago(120), "series-a")]),
    };
    expect(compose(lists, "90").whole).toEqual([]);
  });

  it("T5-07 item 3: (b) drops a next episode that arrived before the series' last play, when that play is outside the window", () => {
    const lists = {
      nextUp: [next("old-episode", "series-a", ago(130))],
      recentlyPlayed: plays([finished("d1", ago(100), "series-a")]),
    };
    expect(compose(lists, "90").whole).toEqual([]);
    expect(compose(lists, "180").whole).toEqual(["old-episode"]);
  });

  it("T5-07 item 3: (c) keeps a Resume card with no date and sorts it after the dated cards", () => {
    const lists = { resume: [film("undated"), film("dated-old", ago(60)), film("dated-new", ago(2)), film("aged", ago(100))] };
    expect(compose(lists, undefined).whole).toEqual(["dated-new", "dated-old", "undated"]);
  });

  it("T5-07 item 3: (d) keeps a next episode, undated and last, when the recently-played list is missing", () => {
    const lists = { resume: [film("dated", ago(10)), film("undated"), film("aged", ago(91))], nextUp: [next("next-unknown", "series-x")] };
    expect(compose(lists, undefined).whole).toEqual(["dated", "undated", "next-unknown"]);
  });

  it("T5-07 item 3: (e) drops a next episode whose series is missing from a complete list and that arrived outside the window", () => {
    const lists = {
      nextUp: [next("next-gone", "series-x", ago(200)), next("next-new", "series-y", ago(5))],
      recentlyPlayed: plays([finished("d1", ago(3), "series-other")]),
    };
    expect(compose(lists, undefined).whole).toEqual(["next-new"]);
  });
});

describe("Continue watching, only hidden (item 4)", () => {
  it("T5-07 item 4: gives the second result regardless of the first, with no state between calls", () => {
    const aged = { resume: [film("replayed", ago(120)), film("other", ago(3))] };
    const replayed = { resume: [film("replayed", ago(1)), film("other", ago(3))] };
    const first = compose(aged, "90");
    expect(first.whole).toEqual(["other"]);
    const second = compose(replayed, "90");
    expect(second.whole).toEqual(["replayed", "other"]);
    expect(second.home.hero).toMatchObject({ rule: "row", card: { id: "replayed" } });
    // The same aged lists, composed again, still give the first answer.
    expect(compose(aged, "90").whole).toEqual(["other"]);
  });

  it("T5-07 item 4: does not change the aged card or its list", () => {
    const aged = film("replayed", ago(120));
    const copy = structuredClone(aged);
    const lists = { resume: [aged, film("other", ago(3))] };
    compose(lists, "90");
    expect(aged).toEqual(copy);
    expect(lists.resume).toHaveLength(2);
  });
});

describe("Continue watching, at most 20 (item 5)", () => {
  it("T5-07 item 5: caps the row at 20 titles", () => {
    expect(CONTINUE_ROW_LIMIT).toBe(20);
  });

  it("T5-07 item 5: gives the 20 newest of 24 dated titles, the hero included, with 19 beneath it", () => {
    const resume = Array.from({ length: 24 }, (_, index) => film(`f${index}`, ago(index + 1)));
    const { home, whole } = compose({ resume }, "all");
    expect(whole).toEqual(Array.from({ length: 20 }, (_, index) => `f${index}`));
    expect(home.hero).toMatchObject({ rule: "row", card: { id: "f0" } });
    expect(home.continueWatching).toHaveLength(19);
  });

  it("T5-07 item 5: interleaves 14 Resume titles and 14 next episodes by date and cuts at 20", () => {
    const resume = Array.from({ length: 14 }, (_, index) => film(`r${index}`, ago(2 * index + 1)));
    const nextUp = Array.from({ length: 14 }, (_, index) => next(`n${index}`, `s${index}`));
    const recentlyPlayed = plays(Array.from({ length: 14 }, (_, index) => finished(`d${index}`, ago(2 * index + 2), `s${index}`)));
    const expected = Array.from({ length: 10 }, (_, index) => [`r${index}`, `n${index}`]).flat();
    expect(compose({ resume, nextUp, recentlyPlayed }, "all").whole).toEqual(expected);
  });

  it("T5-07 item 5: ages out before it cuts: 30 titles of which 12 are aged out give the 18 kept, newest first", () => {
    const aged = Array.from({ length: 12 }, (_, index) => film(`old${index}`, ago(100 + index)));
    const kept = Array.from({ length: 18 }, (_, index) => film(`new${index}`, ago(index + 1)));
    const { whole } = compose({ resume: [...aged, ...kept] }, "90");
    expect(whole).toEqual(kept.map((card) => card.id));
  });
});
