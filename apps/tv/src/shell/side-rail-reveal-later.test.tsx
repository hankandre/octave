// T3-40 item 3: the focused entry stays in view when what it was revealed against changes or arrives after the focus:
// libraries loading above it, the list measuring late, the view or the content changing height.
//
// Layout events go to the element that handles them, so nothing here leans on an event bubbling up to it.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ScrollView } from "react-native";
import type { TestInstance } from "test-renderer";
import type { LibraryView } from "@octave/core/src/domain/catalog";
import { ReducedMotionProvider } from "../design/motion";
import { railEntries } from "./rail-entries";
import { SideRail } from "./side-rail";

jest.mock("../design/scale", () => ({ canvasScale: () => 0.5, px: (canvasPx: number) => canvasPx * 0.5 }));
jest.mock("./focus-bridge", () => require("./test-support/focus-bridge-double"));

const event = { nativeEvent: {} };
const noop = () => undefined;

// dp on a 1080p TV: 32 dp entries 4 dp apart, 4 dp of room above and below, a 424 dp view.
const ENTRY = 32;
const ROOM = 4;
const VIEWPORT = 424;
const contentOf = (count: number): number => count * ENTRY + (count - 1) * ROOM + 2 * ROOM;
const topOf = (index: number): number => ROOM + index * (ENTRY + ROOM);

const library = (id: string): LibraryView => ({ id, name: `Library ${id}`, collectionType: "movies" });
const libraries = Array.from({ length: 14 }, (_, index) => library(`L${index + 1}`));

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
});
afterEach(() => {
  jest.useRealTimers();
});

const rail = (shown: readonly LibraryView[]) => (
  <ReducedMotionProvider value>
    <SideRail testID="rail" entries={railEntries(shown)} current="home" onSelect={noop} onOpenChange={noop} registerEntry={noop} />
  </ReducedMotionProvider>
);

const scrollTo = () => (ScrollView.prototype as unknown as { scrollTo: jest.Mock }).scrollTo;
const lastY = (): number | undefined => (scrollTo().mock.calls.at(-1)?.[0] as { y: number } | undefined)?.y;

function scrollView(): TestInstance {
  const [found] = screen.container.queryAll((node) => node.type === "RCTScrollView");
  if (found === undefined) throw new Error("no ScrollView in the rail");
  return found;
}

/** The element around an entry that is told where the entry sits in the list. */
function laidOutBox(id: string): TestInstance {
  for (let at = screen.getByTestId(id).parent; at !== null; at = at.parent) {
    if (at.props.onLayout !== undefined) return at;
  }
  throw new Error(`nothing measures ${id}`);
}

const layout = (y: number, height: number) => ({ nativeEvent: { layout: { x: 0, y, width: 200, height } } });
const measureView = (height: number) => fireEvent(scrollView(), "layout", layout(0, height));
const measureContent = (height: number) => fireEvent(scrollView(), "contentSizeChange", 200, height);
const measureEntry = (id: string, index: number) => fireEvent(laidOutBox(`rail-entry-${id}`), "layout", layout(topOf(index), ENTRY));

async function focus(id: string) {
  await fireEvent(screen.getByTestId(`rail-entry-${id}`), "focus", event);
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
}

// Home is first in the list, so library L<n> is at index n.
const LAST = "library-L14";
const COUNT = 15;
const END = contentOf(COUNT) - VIEWPORT;

describe("T3-40 item 3: the focused entry stays in view as the list changes", () => {
  it("T3-40 item 3: libraries inserted above the focused one scroll it back into view", async () => {
    const view = await render(rail(libraries));
    await measureView(VIEWPORT);
    await measureContent(contentOf(COUNT));
    await measureEntry(LAST, 14);
    await focus(LAST);
    expect(lastY()).toBe(END);

    await view.rerender(rail([library("N1"), library("N2"), ...libraries]));
    await measureEntry(LAST, 16);
    await measureContent(contentOf(COUNT + 2));
    expect(lastY()).toBe(contentOf(COUNT + 2) - VIEWPORT);
  });

  it("T3-40 item 3: a view that gets shorter scrolls the focused entry back into view", async () => {
    await render(rail(libraries));
    await measureView(VIEWPORT);
    await measureContent(contentOf(COUNT));
    await measureEntry(LAST, 14);
    await focus(LAST);

    await measureView(VIEWPORT - 100);
    expect(lastY()).toBe(END + 100);
  });

  it("T3-40 item 3: content that grows keeps Settings' list at its end", async () => {
    await render(rail(libraries));
    await measureView(VIEWPORT);
    await measureContent(contentOf(COUNT));
    await focus("settings");
    expect(lastY()).toBe(END);

    await measureContent(contentOf(COUNT + 2));
    expect(lastY()).toBe(contentOf(COUNT + 2) - VIEWPORT);
  });

  it("T3-40 item 3: an entry that loses focus no longer moves the list", async () => {
    await render(rail(libraries));
    await measureView(VIEWPORT);
    await measureContent(contentOf(COUNT));
    await measureEntry(LAST, 14);
    await focus(LAST);
    await fireEvent(screen.getByTestId(`rail-entry-${LAST}`), "blur", event);
    scrollTo().mockClear();

    await measureView(VIEWPORT - 100);
    await measureContent(contentOf(COUNT + 2));
    await measureEntry(LAST, 16);
    expect(scrollTo()).not.toHaveBeenCalled();
  });
});

describe("T3-40 item 3: focus that arrives before the list is measured", () => {
  const measures = {
    view: () => measureView(VIEWPORT),
    content: () => measureContent(contentOf(COUNT)),
    entry: () => measureEntry(LAST, 14),
  };
  const orders = [
    ["view", "content", "entry"],
    ["content", "entry", "view"],
    ["entry", "view", "content"],
  ] as const;

  for (const order of orders) {
    it(`T3-40 item 3: scrolls only once all three are known, measured as ${order.join(", ")}`, async () => {
      await render(rail(libraries));
      scrollTo().mockClear();
      await focus(LAST);
      await measures[order[0]]();
      await measures[order[1]]();
      expect(scrollTo()).not.toHaveBeenCalled();

      await measures[order[2]]();
      expect(lastY()).toBe(END);
    });
  }

  it("T3-40 item 3: Settings waits for both heights, then takes the list to its end", async () => {
    await render(rail(libraries));
    scrollTo().mockClear();
    await focus("settings");
    await measureContent(contentOf(COUNT));
    expect(scrollTo()).not.toHaveBeenCalled();

    await measureView(VIEWPORT);
    expect(lastY()).toBe(END);
  });
});
