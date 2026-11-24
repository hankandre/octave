// T5-03 item 10 (the screen half): where focus lands when it enters the rows from the hero. DESIGN.md §9 and §7.4: Up and Down
// go to the card nearest by horizontal centre, so Down from a hero button lands on the card of the first shown row whose centre
// is nearest the focused button's centre, at that row's current scroll offset, and never on a destination left from an earlier
// visit. The row router is the T3-09 spy, so each guide's destinations are read. A hero button sits in a View
// (`home-hero-primary-slot`, `home-hero-more-info-slot`) whose `layout` x is relative to the action bar, and its centre on the
// canvas is (rowInsetStart + x + width / 2) / canvasScale().
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, screen } from "@testing-library/react-native";
import { canvasScale } from "../design/scale";
import { cardCentre, nearestCardIndex, rowInsetStart } from "../design/rows/row-geometry";
import { resetRouters, routers } from "../shell/test-support/row-router-spy";
import { focusEvent, focusOn, layoutEvent, makeRig, renderHome, rowCard } from "./test-support/home-doubles";

jest.mock("@shopify/flash-list", () => require("../design/rows/test-support/flash-list-double"));
jest.mock("../design/rows/row-router", () => require("../shell/test-support/row-router-spy"));

beforeEach(() => {
  resetRouters();
});

const CONTINUE_IDS = ["ep-2", "film-4", "next-ep", "cw-5", "cw-6", "cw-7", "cw-8"];
const ADDED_IDS = ["movie-new", "series-new", "new-2", "new-3", "new-4", "new-5", "new-6", "new-7", "new-8", "new-9"];

const PRIMARY = { x: 0, width: 200 };
const MORE_INFO = { x: 232, width: 240 };
const centreOf = ({ x, width }: { x: number; width: number }): number => (rowInsetStart + x + width / 2) / canvasScale();

const homeRouter = () => {
  const router = routers().at(-1);
  if (router === undefined) throw new Error("Home created no row router");
  return router;
};
const lastDestinations = (rowId: string): unknown[] | undefined => homeRouter().destinationCalls(rowId).at(-1);

async function layoutThenFocus(button: "primary" | "more-info", frame: { x: number; width: number }) {
  await fireEvent(screen.getByTestId(`home-hero-${button}-slot`), "layout", layoutEvent(frame.x, frame.width));
  await focusOn(`home-hero-${button}`);
}

describe("T5-03 item 10: focus enters the rows from the hero at the nearest card", () => {
  it("T5-03 item 10: Down from the hero button points Continue watching at the card nearest its centre, not at the card left from a later row's focus, and clears Recently added", async () => {
    const rig = makeRig();
    await renderHome(rig);
    await focusOn(rowCard("recently-added", 6));
    const stale = nearestCardIndex("thumb", CONTINUE_IDS.length, 0, cardCentre("poster", 6, 0));
    expect(stale).toBeGreaterThan(0);
    expect(lastDestinations("continue-watching")).toEqual([homeRouter().cardView("continue-watching", CONTINUE_IDS[stale]!)]);

    await layoutThenFocus("primary", PRIMARY);
    const near = nearestCardIndex("thumb", CONTINUE_IDS.length, 0, centreOf(PRIMARY));
    expect(near).toBe(0);
    expect(lastDestinations("continue-watching")).toEqual([homeRouter().cardView("continue-watching", CONTINUE_IDS[near]!)]);
    expect(lastDestinations("recently-added")).toEqual([]);
    expect(rig.reporter.focused).toHaveBeenCalledWith("hero-primary", expect.anything());
  });

  it("T5-03 item 10: More info gives the card nearest its own centre", async () => {
    await renderHome(makeRig());
    await layoutThenFocus("more-info", MORE_INFO);
    const near = nearestCardIndex("thumb", CONTINUE_IDS.length, 0, centreOf(MORE_INFO));
    expect(near).toBeGreaterThan(0);
    expect(lastDestinations("continue-watching")).toEqual([homeRouter().cardView("continue-watching", CONTINUE_IDS[near]!)]);
    expect(lastDestinations("recently-added")).toEqual([]);
  });

  it("T5-03 item 10: a scroll of Continue watching moves no destination by itself, and the next entry follows the card nearest at that offset", async () => {
    await renderHome(makeRig());
    await layoutThenFocus("primary", PRIMARY);
    const callsAfterEntry = homeRouter().destinationCalls("continue-watching").length;
    const scrolledTo = 880;
    await fireEvent(screen.getByTestId("home-rows-row-continue-watching-list"), "scroll", { nativeEvent: { contentOffset: { x: scrolledTo * canvasScale() } } });
    expect(homeRouter().destinationCalls("continue-watching")).toHaveLength(callsAfterEntry);
    expect(homeRouter().destinationCalls("recently-added").at(-1)).toEqual([]);

    await fireEvent(screen.getByTestId("home-hero-primary"), "focus", focusEvent);
    const near = nearestCardIndex("thumb", CONTINUE_IDS.length, scrolledTo, centreOf(PRIMARY));
    expect(near).toBeGreaterThan(0);
    expect(lastDestinations("continue-watching")).toEqual([homeRouter().cardView("continue-watching", CONTINUE_IDS[near]!)]);
  });

  it("T5-03 item 10: with Continue watching empty the first shown row is Recently added, and its guide gets the destination", async () => {
    await renderHome(makeRig({ resume: [], nextUp: [] }));
    await layoutThenFocus("more-info", MORE_INFO);
    // The hero is the newest film, so the row holds the rest of the list.
    const count = ADDED_IDS.length - 1;
    const near = nearestCardIndex("poster", count, 0, centreOf(MORE_INFO));
    expect(near).toBeGreaterThan(0);
    const calls = homeRouter().destinationCalls("recently-added");
    expect(calls.at(-1)).toHaveLength(1);
    expect(calls.at(-1)).toEqual([homeRouter().cardView("recently-added", ADDED_IDS.slice(1)[near]!)]);
    expect(homeRouter().destinationCalls("continue-watching")).toEqual([]);
  });
});
