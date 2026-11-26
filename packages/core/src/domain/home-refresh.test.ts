import { describe, expect, it } from "vitest";
import { toMediaCard } from "../jellyfin/cards";
import type { BaseItemDto } from "../jellyfin/types";
import type { ItemUserData, MediaCard } from "./catalog";
import type { Home } from "./home";
import { withViewedProgress } from "./home-refresh";

// T8-03 item 7 (D8): after a viewing, every Home card of the viewed item shows what the server now holds, by the
// card rules of jellyfin/cards.ts, and nothing else on Home moves. The expected cards come from those rules.

const RUN_TIME_TICKS = 36_000_000_000;
const SAVED_TICKS = 6_000_000_000;
const VIEWED_TICKS = 27_000_000_000;

function cardOf(id: string, userData: BaseItemDto["UserData"] = {}): MediaCard {
  const card = toMediaCard({
    Id: id,
    Name: `Film ${id}`,
    Type: "Movie",
    ProductionYear: 2024,
    RunTimeTicks: RUN_TIME_TICKS,
    ImageTags: { Primary: `tag-${id}` },
    UserData: userData,
  });
  if (card === undefined) throw new Error("the fixture must make a card");
  return card;
}

const savedCard = () => cardOf("viewed", { PlaybackPositionTicks: SAVED_TICKS });

function homeShowing(viewed: MediaCard): Home {
  const other = cardOf("other", { PlaybackPositionTicks: SAVED_TICKS });
  const added = cardOf("added");
  return {
    hero: { rule: "row", card: viewed },
    continueWatching: [other, viewed, cardOf("last", { PlaybackPositionTicks: 1 })],
    recentlyAdded: [added, viewed],
  };
}

const userData = (resumePositionTicks: number, played = false): ItemUserData => ({ played, favorite: false, resumePositionTicks });

describe("withViewedProgress", () => {
  it("T8-03 item 7: patches the hero's card and the card in both rows, keeping every order and every other card", () => {
    const patched = withViewedProgress(homeShowing(savedCard()), {
      itemId: "viewed",
      userData: userData(VIEWED_TICKS),
      runTimeTicks: RUN_TIME_TICKS,
    });

    const expected = homeShowing(cardOf("viewed", { PlaybackPositionTicks: VIEWED_TICKS }));
    expect(patched).toEqual(expected);
    expect(patched.continueWatching[1]).toMatchObject({
      resumePositionTicks: VIEWED_TICKS,
      progress: 0.75,
      remainingTicks: RUN_TIME_TICKS - VIEWED_TICKS,
    });
  });

  it("T8-03 item 7: gives a card that had not been started its position and progress", () => {
    const patched = withViewedProgress(homeShowing(cardOf("viewed")), {
      itemId: "viewed",
      userData: userData(VIEWED_TICKS),
      runTimeTicks: RUN_TIME_TICKS,
    });

    expect(patched).toEqual(homeShowing(cardOf("viewed", { PlaybackPositionTicks: VIEWED_TICKS })));
  });

  it("T8-03 item 7: leaves the home it was given as it was", () => {
    const home = homeShowing(savedCard());

    withViewedProgress(home, { itemId: "viewed", userData: userData(VIEWED_TICKS), runTimeTicks: RUN_TIME_TICKS });

    expect(home).toEqual(homeShowing(savedCard()));
  });

  it("T8-03 item 7: returns a home without the viewed item unchanged", () => {
    const patched = withViewedProgress(homeShowing(savedCard()), {
      itemId: "somewhere-else",
      userData: userData(VIEWED_TICKS),
      runTimeTicks: RUN_TIME_TICKS,
    });

    expect(patched).toEqual(homeShowing(savedCard()));
  });

  it("T8-03 item 7: clears the position and progress once the item is played", () => {
    const patched = withViewedProgress(homeShowing(savedCard()), {
      itemId: "viewed",
      userData: userData(0, true),
      runTimeTicks: RUN_TIME_TICKS,
    });

    expect(patched).toEqual(homeShowing(cardOf("viewed", { Played: true })));
  });

  it("T8-03 item 7: clears the played mark when a played item is part-watched again", () => {
    const patched = withViewedProgress(homeShowing(cardOf("viewed", { Played: true })), {
      itemId: "viewed",
      userData: userData(VIEWED_TICKS),
      runTimeTicks: RUN_TIME_TICKS,
    });

    expect(patched).toEqual(homeShowing(cardOf("viewed", { PlaybackPositionTicks: VIEWED_TICKS })));
  });

  it("T8-03 item 7: clears the position and progress when the server holds no resume point", () => {
    const patched = withViewedProgress(homeShowing(savedCard()), {
      itemId: "viewed",
      userData: userData(0),
      runTimeTicks: RUN_TIME_TICKS,
    });

    expect(patched).toEqual(homeShowing(cardOf("viewed")));
  });

  it("T8-03 item 7: patches the rows of a home that has no hero", () => {
    const home: Home = { hero: { rule: "none" }, continueWatching: [savedCard()], recentlyAdded: [] };

    const patched = withViewedProgress(home, {
      itemId: "viewed",
      userData: userData(VIEWED_TICKS),
      runTimeTicks: RUN_TIME_TICKS,
    });

    expect(patched).toEqual({
      hero: { rule: "none" },
      continueWatching: [cardOf("viewed", { PlaybackPositionTicks: VIEWED_TICKS })],
      recentlyAdded: [],
    });
  });
});
