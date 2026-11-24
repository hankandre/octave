// T5-03 items 1, 2, 3, 4, 5, 7 and 9 (the app half): Home on the screen, rendered over fake services. Jest has no focus
// engine, so a focus is delivered as the event and a select as the press events (`pressSelect`). The real focus movement is
// T5-06's Shield check and T3-10's run. The rows come from the frozen FlashList double.
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { act, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import type { ItemDetail, MediaCard } from "@octave/core/src/domain/catalog";
import { startOverChoice } from "@octave/core/src/domain/playback";
import type { RecentPlays } from "@octave/core/src/domain/up-next";
import { testIDOf } from "../shell/test-support/focus-bridge-double";
import {
  MINUTE,
  cardLabels,
  cwEpisode,
  cwFilm,
  deferred,
  defaultLists,
  detailOf,
  flush,
  focusOn,
  heroFilm,
  makeRig,
  newMovie,
  newSeries,
  nextEpisode,
  preferredFocus,
  press,
  renderHome,
  rowCard,
  shownRows,
  textOf,
  type Rig,
} from "./test-support/home-doubles";

jest.mock("@shopify/flash-list", () => require("../design/rows/test-support/flash-list-double"));

afterEach(() => {
  jest.useRealTimers();
});

/** Everything in the tree that is a Modal, an alert or dialog role, or has a testID with dialog or notice in it. */
function dialogLike(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) for (const child of node) dialogLike(child, out);
  else if (node !== null && typeof node === "object") {
    const element = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown };
    const props = element.props ?? {};
    const id = typeof props.testID === "string" ? props.testID : "";
    const roles = [props.role, props.accessibilityRole];
    if (element.type === "Modal" || roles.some((role) => role === "alert" || role === "dialog" || role === "alertdialog") || /dialog|notice/i.test(id)) out.push(`${String(element.type)}:${id}`);
    dialogLike(element.children ?? [], out);
  }
  return out;
}

const openedView = (rig: Rig): string | undefined => testIDOf(rig.reporter.opening.mock.calls.at(-1)?.[0]);

describe("T5-03 item 1: opening focus and the hero's select", () => {
  it("T5-03 item 1: an in-progress film reads Resume, is the only preferred focus and the opening view, and one select hands the title and its saved position to play", async () => {
    const rig = makeRig();
    await renderHome(rig);
    const primary = screen.getByTestId("home-hero-primary");
    expect(primary.props.accessibilityLabel).toBe("Resume");
    expect(preferredFocus()).toEqual(["home-hero-primary"]);
    expect(openedView(rig)).toBe("home-hero-primary");
    await press("home-hero-primary");
    expect(rig.play).toHaveBeenCalledTimes(1);
    expect(rig.play).toHaveBeenCalledWith({ itemId: "hero-film", start: { kind: "resume", startPositionTicks: 90 * MINUTE } });
    expect(rig.open).not.toHaveBeenCalled();
  });

  it("T5-03 item 1: a next episode with no saved position reads Play and hands start over", async () => {
    const rig = makeRig({ resume: [], nextUp: [nextEpisode] });
    await renderHome(rig);
    expect(screen.getByTestId("home-hero-primary").props.accessibilityLabel).toBe("Play");
    expect(preferredFocus()).toEqual(["home-hero-primary"]);
    await press("home-hero-primary");
    expect(rig.play).toHaveBeenCalledTimes(1);
    expect(rig.play).toHaveBeenCalledWith({ itemId: "next-ep", start: startOverChoice() });
    expect(rig.open).not.toHaveBeenCalled();
  });

  it("T5-03 item 1: a Series hero hands the series' next episode and its position, never the series", async () => {
    const rig = makeRig({
      resume: [],
      nextUp: [],
      latest: [newSeries, newMovie],
      seriesNextUp: async () => ({ id: "series-new-s2e1", title: "Second Tide", seasonNumber: 2, episodeNumber: 1, resumePositionTicks: 12 * MINUTE }),
    });
    await renderHome(rig);
    expect(rig.source.seriesNextUp).toHaveBeenCalledTimes(1);
    expect(rig.source.seriesNextUp.mock.calls[0]?.[0]).toBe("series-new");
    expect(screen.getByTestId("home-hero-primary").props.accessibilityLabel).toBe("Resume");
    await press("home-hero-primary");
    expect(rig.play).toHaveBeenCalledTimes(1);
    expect(rig.play).toHaveBeenCalledWith({ itemId: "series-new-s2e1", start: { kind: "resume", startPositionTicks: 12 * MINUTE } });
    expect(rig.open).not.toHaveBeenCalled();
  });

  it("T5-03 item 1: a Series hero whose next-up read gives nothing shows only More info, focused and opening, and never calls play", async () => {
    const rig = makeRig({ resume: [], nextUp: [], latest: [newSeries, newMovie], seriesNextUp: async () => undefined });
    await renderHome(rig);
    expect(screen.queryByTestId("home-hero-primary")).toBeNull();
    expect(screen.getByTestId("home-hero-more-info").props.accessibilityLabel).toBe("More info");
    expect(preferredFocus()).toEqual(["home-hero-more-info"]);
    expect(openedView(rig)).toBe("home-hero-more-info");
    await press("home-hero-more-info");
    expect(rig.open).toHaveBeenCalledWith({ kind: "item", id: "series-new" });
    expect(rig.play).not.toHaveBeenCalled();
  });

  it("T5-03 item 1: More info opens the hero's page and plays nothing", async () => {
    const rig = makeRig();
    await renderHome(rig);
    await press("home-hero-more-info");
    expect(rig.open).toHaveBeenCalledTimes(1);
    expect(rig.open).toHaveBeenCalledWith({ kind: "item", id: "hero-film" });
    expect(rig.play).not.toHaveBeenCalled();
  });
});

describe("T5-03 item 2: Continue watching is the first row", () => {
  it("T5-03 item 2: the rows render Continue watching first, and its first card is the title after the hero, not the hero again", async () => {
    const rig = makeRig();
    await renderHome(rig);
    expect(shownRows()).toEqual(["continue-watching", "recently-added"]);
    expect(textOf(`${rowCard("continue-watching", 0)}-title`)).toBe(cwEpisode.title);
    expect(cardLabels().some((label) => label.includes(heroFilm.title))).toBe(false);
  });

  it("T5-03 item 2: one select on a card hands it to play with its saved position, and a card with none hands start over", async () => {
    const rig = makeRig();
    await renderHome(rig);
    await press(rowCard("continue-watching", 1));
    expect(rig.play).toHaveBeenCalledTimes(1);
    expect(rig.play).toHaveBeenLastCalledWith({ itemId: "film-4", start: { kind: "resume", startPositionTicks: cwFilm.resumePositionTicks } });
    await press(rowCard("continue-watching", 2));
    expect(rig.play).toHaveBeenCalledTimes(2);
    expect(rig.play).toHaveBeenLastCalledWith({ itemId: "next-ep", start: startOverChoice() });
    await press(rowCard("continue-watching", 0));
    expect(rig.play).toHaveBeenLastCalledWith({ itemId: "ep-2", start: { kind: "resume", startPositionTicks: 20 * MINUTE } });
    expect(rig.open).not.toHaveBeenCalled();
  });
});

describe("T5-03 item 3: Recently added opens pages", () => {
  it("T5-03 item 3: Recently added is the second row; a movie card opens the movie's page and a show card the series page", async () => {
    const rig = makeRig();
    await renderHome(rig);
    expect(shownRows()[1]).toBe("recently-added");
    await press(rowCard("recently-added", 0));
    expect(rig.open).toHaveBeenLastCalledWith({ kind: "item", id: "movie-new" });
    await press(rowCard("recently-added", 1));
    expect(rig.open).toHaveBeenLastCalledWith({ kind: "item", id: "series-new" });
    expect(rig.open).toHaveBeenCalledTimes(2);
    expect(rig.play).not.toHaveBeenCalled();
  });
});

describe("T5-03 item 4: the row order is fixed and an empty row is hidden", () => {
  it("T5-03 item 4: two visits with different lists give the same row order", async () => {
    const first = await renderHome(makeRig());
    const order = shownRows();
    await first.unmount();
    await renderHome(makeRig({ resume: [heroFilm, cwEpisode], nextUp: [], latest: [newSeries, newMovie, nextEpisode] }));
    expect(shownRows()).toEqual(order);
    expect(order).toEqual(["continue-watching", "recently-added"]);
  });

  it("T5-03 item 4: with Continue watching empty only Recently added renders, under the hero", async () => {
    await renderHome(makeRig({ resume: [], nextUp: [] }));
    expect(shownRows()).toEqual(["recently-added"]);
    expect(screen.queryByTestId("home-hero-title")).not.toBeNull();
    expect(screen.queryAllByTestId(/^home-rows-row-(?!recently-added)[a-z-]+$/)).toHaveLength(0);
  });

  it("T5-03 item 4: with Recently added empty only Continue watching renders", async () => {
    await renderHome(makeRig({ latest: [] }));
    expect(shownRows()).toEqual(["continue-watching"]);
    expect(screen.queryAllByTestId(/^home-rows-row-(?!continue-watching)[a-z-]+$/)).toHaveLength(0);
  });
});

describe("T5-03 item 5: no prompt, no library tiles, nothing plays by itself", () => {
  it("T5-03 item 5: after selecting the hero and a card there is no dialog, play ran once per press, and no library read was made", async () => {
    const rig = makeRig();
    const forbidden = { userViews: jest.fn(() => { throw new Error("userViews"); }), latestInLibrary: jest.fn(() => { throw new Error("latestInLibrary"); }) };
    Object.assign(rig.source, forbidden);
    await renderHome(rig);
    expect(dialogLike(screen.toJSON())).toEqual([]);
    await press("home-hero-primary");
    expect(rig.play).toHaveBeenCalledTimes(1);
    expect(dialogLike(screen.toJSON())).toEqual([]);
    await press(rowCard("continue-watching", 0));
    expect(rig.play).toHaveBeenCalledTimes(2);
    expect(dialogLike(screen.toJSON())).toEqual([]);
    expect(forbidden.userViews).not.toHaveBeenCalled();
    expect(forbidden.latestInLibrary).not.toHaveBeenCalled();
    expect(shownRows()).toEqual(["continue-watching", "recently-added"]);
  });

  it("T5-03 item 5: mounting, loading, focusing cards and ten minutes of timers call play zero times", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
    const rig = makeRig();
    await renderHome(rig);
    await focusOn(rowCard("continue-watching", 0));
    await focusOn(rowCard("recently-added", 3));
    await focusOn("home-hero-primary");
    await act(async () => {
      jest.advanceTimersByTime(10 * 60 * 1000);
    });
    await flush();
    expect(rig.play).not.toHaveBeenCalled();
    expect(rig.open).not.toHaveBeenCalled();
  });
});

describe("T5-03 item 7: rows wait for their data", () => {
  it("T5-03 item 7: three of four lists draw nothing, the fourth draws both rows and the hero at once, and nothing reorders when the detail arrives", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
    const lists = defaultLists();
    const resume = deferred<MediaCard[]>();
    const nextUp = deferred<MediaCard[]>();
    const plays = deferred<RecentPlays>();
    const latest = deferred<MediaCard[]>();
    const detail = deferred<ItemDetail>();
    const rig = makeRig({ resume: resume.promise, nextUp: nextUp.promise, recentlyPlayed: plays.promise, latest: latest.promise, itemDetail: () => detail.promise });
    await renderHome(rig);
    const nothingShown = () => {
      expect(shownRows()).toEqual([]);
      expect(screen.queryByTestId("home-hero-primary")).toBeNull();
      expect(screen.queryByTestId("home-hero-title")).toBeNull();
    };
    nothingShown();
    for (const settle of [() => resume.resolve(lists.resume), () => nextUp.resolve(lists.nextUp), () => plays.resolve(lists.recentlyPlayed)]) {
      await act(async () => settle());
      await flush();
      nothingShown();
    }
    await act(async () => latest.resolve(lists.latest));
    await flush();
    expect(shownRows()).toEqual(["continue-watching", "recently-added"]);
    expect(screen.queryByTestId("home-hero-primary")).not.toBeNull();
    const before = cardLabels();
    expect(before.length).toBeGreaterThan(0);
    const heights = () => ["home-hero-facts-slot", "home-hero-overview-slot"].map((id) => StyleSheet.flatten(screen.getByTestId(id).props.style)?.height);
    const heightsBefore = heights();
    expect(heightsBefore.every((height) => typeof height === "number")).toBe(true);
    await act(async () => detail.resolve(detailOf("hero-film")));
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(cardLabels()).toEqual(before);
    expect(shownRows()).toEqual(["continue-watching", "recently-added"]);
    expect(heights()).toEqual(heightsBefore);
  });
});

describe("T5-03 item 9: the hero's facts and overview on the screen", () => {
  it("T5-03 item 9: the hero shows the card's facts at once, the detail's facts and overview when it resolves, from one item read", async () => {
    const detail = deferred<ItemDetail>();
    const rig = makeRig({ itemDetail: () => detail.promise });
    await renderHome(rig);
    expect(textOf("home-hero-title")).toBe("Harbor Lights");
    expect(textOf("home-hero-facts")).toBe("2023");
    expect(screen.queryByTestId("home-hero-overview")).toBeNull();
    await act(async () => detail.resolve(detailOf("hero-film")));
    await flush();
    expect(textOf("home-hero-facts")).toBe("2023 · 2 h 3 min · 4K · Dolby Vision");
    expect(textOf("home-hero-overview")).toBe(detailOf("hero-film").overview);
    expect(rig.source.itemDetail).toHaveBeenCalledTimes(1);
    expect(rig.source.itemDetail.mock.calls[0]?.[0]).toBe("hero-film");
  });

  it("T5-03 item 9: an episode hero shows its season, episode and time left from the card alone", async () => {
    const rig = makeRig({ resume: [cwEpisode, cwFilm] });
    await renderHome(rig);
    expect(textOf("home-hero-facts")).toBe("S1 · E2 · 38 min left");
  });

  it("T5-03 item 9: a failed detail leaves the card's facts, no overview and no error text", async () => {
    const rig = makeRig({ itemDetail: async () => { throw new Error("detail-failure-xyz"); } });
    await renderHome(rig);
    expect(textOf("home-hero-facts")).toBe("2023");
    expect(screen.queryByTestId("home-hero-overview")).toBeNull();
    expect(JSON.stringify(screen.toJSON())).not.toContain("detail-failure-xyz");
    expect(shownRows()).toEqual(["continue-watching", "recently-added"]);
  });
});
