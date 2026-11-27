// T5-09 items 1 and 2: focus on Home's hero. Jest has no focus engine and no native scroll, so these check the
// preconditions of the moves: the hero is one focus guide that traps only Right and holds the title and both buttons, the
// guide is pointed at the opening button, and a focused hero button scrolls the vertical list to its top. The moves
// themselves are the task's emulator evidence. The focus bridge and the row router are the T3-09 doubles, FlashList the
// T3-08 double. Only calls on the `home-hero` guide count.
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen, within } from "@testing-library/react-native";
import { ReducedMotionProvider } from "../design/motion";
import { resetScrollCalls, scrollCalls } from "../design/rows/test-support/flash-list-double";
import { pointGuide, resetFocusBridge, testIDOf } from "../shell/test-support/focus-bridge-double";
import { resetRouters } from "../shell/test-support/row-router-spy";
import { Hero, type HeroProps } from "./hero";
import { focusOn, makeRig, newMovie, newSeries, renderHome, rowCard, type Rig } from "./test-support/home-doubles";

jest.mock("@shopify/flash-list", () => require("../design/rows/test-support/flash-list-double"));
jest.mock("../shell/focus-bridge", () => require("../shell/test-support/focus-bridge-double"));
jest.mock("../design/rows/row-router", () => require("../shell/test-support/row-router-spy"));

beforeEach(() => {
  resetFocusBridge();
  resetRouters();
  resetScrollCalls();
});

/** A hero with a primary action (Resume). */
const withPrimary = (): Rig => makeRig();
/** A series with no next episode: More info is the only, and the opening, action. */
const withoutPrimary = (): Rig => makeRig({ resume: [], nextUp: [], latest: [newSeries, newMovie], seriesNextUp: async () => undefined });

/** The testIDs of the views each call on the hero's guide named, in order. */
const heroGuideCalls = (): unknown[][] => pointGuide.mock.calls.filter(([guide]) => testIDOf(guide) === "home-hero").map(([, views]) => views.map(testIDOf));

const trapsOf = () => {
  const { trapFocusRight, trapFocusLeft, trapFocusUp, trapFocusDown } = screen.getByTestId("home-hero").props;
  return { trapFocusRight, trapFocusLeft: Boolean(trapFocusLeft), trapFocusUp: Boolean(trapFocusUp), trapFocusDown: Boolean(trapFocusDown) };
};

const ONLY_RIGHT_TRAPPED = { trapFocusRight: true, trapFocusLeft: false, trapFocusUp: false, trapFocusDown: false };

describe("T5-09 item 1: Right on the hero's last button stays on it", () => {
  it("T5-09 item 1: with Resume and More info, the hero holds both buttons and traps Right only", async () => {
    await renderHome(withPrimary());
    expect(trapsOf()).toEqual(ONLY_RIGHT_TRAPPED);
    const hero = within(screen.getByTestId("home-hero"));
    expect(hero.getByTestId("home-hero-primary")).toBeTruthy();
    expect(hero.getByTestId("home-hero-more-info")).toBeTruthy();
  });

  it("T5-09 item 1: with More info alone, the hero holds it and traps Right only", async () => {
    await renderHome(withoutPrimary());
    expect(screen.queryByTestId("home-hero-primary")).toBeNull();
    expect(trapsOf()).toEqual(ONLY_RIGHT_TRAPPED);
    expect(within(screen.getByTestId("home-hero")).getByTestId("home-hero-more-info")).toBeTruthy();
  });
});

describe("T5-09 item 2: Up from the first row lands on the hero's primary action", () => {
  it("T5-09 item 2: the hero's guide names only the primary action", async () => {
    await renderHome(withPrimary());
    expect(heroGuideCalls().at(-1)).toEqual(["home-hero-primary"]);
  });

  it("T5-09 item 2: with no primary the hero's guide names only More info", async () => {
    await renderHome(withoutPrimary());
    expect(heroGuideCalls().at(-1)).toEqual(["home-hero-more-info"]);
  });

  it("T5-09 item 2: focus on a card and then on More info leaves the guide naming the primary action", async () => {
    await renderHome(withPrimary());
    await focusOn(rowCard("continue-watching", 2));
    await focusOn("home-hero-more-info");
    expect(heroGuideCalls().at(-1)).toEqual(["home-hero-primary"]);
  });

  it("T5-09 item 2: when the opening action changes the guide is pointed at the new one", async () => {
    const entryRef = { current: null };
    const hero = (primaryLabel: HeroProps["primaryLabel"]) => (
      <ReducedMotionProvider value>
        <Hero title="Harbor Lights" facts="2023" primaryLabel={primaryLabel} onPrimary={() => undefined} onMoreInfo={() => undefined} onFocusAction={() => undefined} entryRef={entryRef} />
      </ReducedMotionProvider>
    );
    const view = await render(hero(undefined));
    expect(heroGuideCalls().at(-1)).toEqual(["home-hero-more-info"]);
    await view.rerender(hero("Play"));
    expect(heroGuideCalls().at(-1)).toEqual(["home-hero-primary"]);
    await view.rerender(hero(undefined));
    expect(heroGuideCalls().at(-1)).toEqual(["home-hero-more-info"]);
  });

  it("T5-09 item 2: the title, facts and overview are part of the area Up scrolls to", async () => {
    await renderHome(withPrimary());
    const hero = within(screen.getByTestId("home-hero"));
    expect(hero.getByTestId("home-hero-title")).toBeTruthy();
    expect(hero.getByTestId("home-hero-facts")).toBeTruthy();
    expect(hero.getByTestId("home-hero-overview")).toBeTruthy();
  });

  it.each(["home-hero-primary", "home-hero-more-info"])("T5-09 item 2: focus on %s from a card scrolls Home to its top at once", async (button) => {
    await renderHome(withPrimary());
    await focusOn(rowCard("continue-watching", 2));
    resetScrollCalls();
    await focusOn(button);
    expect(scrollCalls("home-rows-list").at(-1)).toEqual({ offset: 0, animated: false });
  });

  it("T5-09 item 2: with no primary, focus on More info scrolls Home to its top at once", async () => {
    await renderHome(withoutPrimary());
    resetScrollCalls();
    await focusOn("home-hero-more-info");
    expect(scrollCalls("home-rows-list").at(-1)).toEqual({ offset: 0, animated: false });
  });
});
