// T3-40 items 2 to 5: how a focused rail entry looks, and the room the rail leaves around every entry.
//
// Jest draws nothing, so the room is summed from the drawn tree's flattened styles: the paddings, margins and gaps
// between an entry and each box around it. Jest's ScrollView mock does not style its content box, so the content box
// takes the ScrollView's `contentContainerStyle`, as the TV draws it.
//
// The window is the Shield's: 960 dp wide at density 2, so one canvas px is exactly one device pixel (0.5 dp).
//
// Overflow: Android's own scroll to a focused child leaves it flush with the edge, cutting its ring, so the rail
// reveals the entry itself. The test delivers the layout, content size and scroll events the TV would, and reads the
// ScrollView's `scrollTo` calls (the product-owner ruling of 2026-11-26 on T3-40: no scroll animation, and Search and
// Settings reset the offset to the start and the end).
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ScrollView, StyleSheet } from "react-native";
import type { TestInstance } from "test-renderer";
import type { LibraryView } from "@octave/core/src/domain/catalog";
import { ReducedMotionProvider } from "../design/motion";
import { px } from "../design/scale";
import { colors, focus, sizes } from "../design/tokens";
import { hasTransform } from "../design/test-support/harness";
import { railEntries } from "./rail-entries";
import { SideRail } from "./side-rail";
import { fixtureAccount, fixtureLibraries } from "./test-support/shell-fixtures";

jest.mock("../design/scale", () => ({ canvasScale: () => 0.5, px: (canvasPx: number) => canvasPx * 0.5 }));
jest.mock("./focus-bridge", () => require("./test-support/focus-bridge-double"));

const event = { nativeEvent: {} };
/** How far the two-tone ring reaches outside the box it surrounds: 7 canvas px. */
const RING_REACH = px(focus.focusOffset + focus.focusRingWidth + focus.focusEdgeWidth);
const INSET = px(16);

const MIDDLE = ["home", "library-A", "library-B", "library-C"].map((key) => `rail-entry-${key}`);
const ENTRIES = ["rail-entry-search", ...MIDDLE, "rail-entry-settings", "rail-entry-account"];

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
});
afterEach(() => {
  jest.useRealTimers();
});

async function renderRail(libraries: readonly LibraryView[] = fixtureLibraries) {
  const noop = () => undefined;
  await render(
    <ReducedMotionProvider value={false}>
      <SideRail testID="rail" entries={railEntries(libraries, fixtureAccount)} current="home" onSelect={noop} onOpenChange={noop} registerEntry={noop} />
    </ReducedMotionProvider>,
  );
}

async function focusEntry(id: string) {
  await fireEvent(screen.getByTestId(id), "focus", event);
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
}

type Style = Record<string, unknown>;
type Side = "Top" | "Right" | "Bottom" | "Left";

const flatten = (style: unknown): Style => (StyleSheet.flatten(style as never) ?? {}) as Style;
const isScrollView = (node: TestInstance): boolean => node.type === "RCTScrollView";

/** A box's own style; the ScrollView's content box takes `contentContainerStyle`. */
function boxStyle(node: TestInstance): Style {
  const parent = node.parent;
  if (parent !== null && isScrollView(parent)) return flatten([node.props.style, parent.props.contentContainerStyle]);
  return flatten(node.props.style);
}

function inset(style: Style, kind: "padding" | "margin", side: Side): number {
  const axis = side === "Top" || side === "Bottom" ? "Vertical" : "Horizontal";
  return Number(style[`${kind}${side}`] ?? style[`${kind}${axis}`] ?? style[kind] ?? 0);
}

const gapOf = (style: Style): number => Number(style.rowGap ?? style.gap ?? 0);

/** The boxes from `node`'s parent up to the root. */
function ancestors(node: TestInstance): TestInstance[] {
  const found: TestInstance[] = [];
  for (let at = node.parent; at !== null; at = at.parent) found.push(at);
  return found;
}

/** The space between the node's `side` and the same side of `outer`, a box around it. */
function roomInside(node: TestInstance, outer: TestInstance, side: Side): number {
  let room = inset(boxStyle(node), "margin", side);
  for (const box of ancestors(node)) {
    room += inset(boxStyle(box), "padding", side);
    if (box === outer) return room;
    room += inset(boxStyle(box), "margin", side);
  }
  throw new Error("the box is not around the node");
}

/** The least space between the bottom of `upper` and the top of `lower`, the next entry down. */
function spaceBetween(upper: TestInstance, lower: TestInstance): number {
  const lowerChain = [lower, ...ancestors(lower)];
  const common = ancestors(upper).find((box) => lowerChain.includes(box));
  if (common === undefined) throw new Error("the entries share no box");
  const edgeSpace = (node: TestInstance, side: Side): number => {
    let total = 0;
    for (let at = node; at !== common; at = at.parent as TestInstance) {
      total += inset(boxStyle(at), "margin", side);
      if (at.parent !== common) total += inset(boxStyle(at.parent as TestInstance), "padding", side);
    }
    return total;
  };
  const commonStyle = isScrollView(common) ? flatten(common.props.contentContainerStyle) : boxStyle(common);
  return edgeSpace(upper, "Bottom") + gapOf(commonStyle) + edgeSpace(lower, "Top");
}

const scrollContent = (entry: TestInstance): TestInstance => {
  const content = ancestors(entry).find((box) => box.parent !== null && isScrollView(box.parent));
  if (content === undefined) throw new Error(`${String(entry.props.testID)} is not in the scrolling group`);
  return content;
};

describe("T3-40 item 2: a focused rail entry is a row: a ring and a surface3 fill, never a lift", () => {
  for (const id of ["rail-entry-home", "rail-entry-library-A", "rail-entry-settings"]) {
    it(`T3-40 item 2: ${id} shows the ring and the fill without scaling, on focus and on press, and loses the fill on blur`, async () => {
      await renderRail();
      const box = () => screen.getByTestId(`${id}-scale`);
      expect(flatten(box().props.style).backgroundColor).not.toBe(colors.surface3);

      await focusEntry(id);
      expect(screen.getByTestId(`${id}-focus-ring`)).toBeTruthy();
      expect(flatten(box().props.style).backgroundColor).toBe(colors.surface3);
      expect(hasTransform(box())).toBe(false);

      await fireEvent(screen.getByTestId(id), "pressIn", event);
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      expect(hasTransform(box())).toBe(false);

      await fireEvent(screen.getByTestId(id), "pressOut", event);
      await fireEvent(screen.getByTestId(id), "blur", event);
      expect(flatten(box().props.style).backgroundColor).not.toBe(colors.surface3);
    });
  }
});

describe("T3-40 item 3: with the rail open, nothing cuts any entry's ring", () => {
  it("T3-40 item 3: every entry has room for its whole ring inside the rail, left and right, and Search above and the account below", async () => {
    await renderRail();
    await focusEntry("rail-entry-home");
    const rail = screen.getByTestId("rail");
    for (const id of ENTRIES) {
      const entry = screen.getByTestId(id);
      expect({ id, left: roomInside(entry, rail, "Left") >= RING_REACH, right: roomInside(entry, rail, "Right") >= RING_REACH }).toEqual({ id, left: true, right: true });
    }
    expect(roomInside(screen.getByTestId("rail-entry-search"), rail, "Top")).toBeGreaterThanOrEqual(RING_REACH);
    expect(roomInside(screen.getByTestId("rail-entry-account"), rail, "Bottom")).toBeGreaterThanOrEqual(RING_REACH);
  });

  it("T3-40 item 3: the scrolling group leaves room for the whole ring at its sides, above Home and below the last library", async () => {
    await renderRail();
    await focusEntry("rail-entry-home");
    for (const id of MIDDLE) {
      const entry = screen.getByTestId(id);
      const content = scrollContent(entry);
      expect({ id, left: roomInside(entry, content, "Left") >= RING_REACH, right: roomInside(entry, content, "Right") >= RING_REACH }).toEqual({ id, left: true, right: true });
    }
    const first = screen.getByTestId("rail-entry-home");
    const last = screen.getByTestId("rail-entry-library-C");
    expect(roomInside(first, scrollContent(first), "Top")).toBeGreaterThanOrEqual(RING_REACH);
    expect(roomInside(last, scrollContent(last), "Bottom")).toBeGreaterThanOrEqual(RING_REACH);
  });

  it("T3-40 item 3: each focused entry draws its ring around a box that does not grow", async () => {
    await renderRail();
    for (const id of ENTRIES) {
      await focusEntry(id);
      expect(screen.getByTestId(`${id}-focus-ring`)).toBeTruthy();
      expect({ id, scaled: hasTransform(screen.getByTestId(`${id}-scale`)) }).toEqual({ id, scaled: false });
      await fireEvent(screen.getByTestId(id), "blur", event);
    }
  });
});

describe("T3-40 item 3: with more libraries than the rail holds, the focused entry and its ring are scrolled into view", () => {
  const libraries: LibraryView[] = Array.from({ length: 14 }, (_, index) => ({ id: `L${index + 1}`, name: `Library ${index + 1}`, collectionType: "movies" }));
  const scrolled = ["rail-entry-home", ...libraries.map((library) => `rail-entry-library-${library.id}`)];

  // The TV's geometry in dp: an 848 canvas px viewport, 64 px entries 8 px apart, 8 px of padding above and below.
  const ENTRY_HEIGHT = px(sizes.hitMin);
  const ROOM = px(8);
  const VIEWPORT = px(848);
  const CONTENT = scrolled.length * ENTRY_HEIGHT + (scrolled.length - 1) * ROOM + 2 * ROOM;
  const END = CONTENT - VIEWPORT;
  const topOf = (index: number): number => ROOM + index * (ENTRY_HEIGHT + ROOM);

  const scrollTo = () => (ScrollView.prototype as unknown as { scrollTo: jest.Mock }).scrollTo;
  const scrollView = (): TestInstance => {
    const [found] = screen.container.queryAll(isScrollView);
    if (found === undefined) throw new Error("no ScrollView in the rail");
    return found;
  };

  async function renderOverflow() {
    await renderRail(libraries);
    await fireEvent(scrollView(), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: px(sizes.railOpenW), height: VIEWPORT } } });
    await fireEvent(scrollView(), "contentSizeChange", px(sizes.railOpenW), CONTENT);
    for (const [index, id] of scrolled.entries()) {
      await fireEvent(screen.getByTestId(id), "layout", { nativeEvent: { layout: { x: INSET, y: topOf(index), width: px(sizes.railOpenW) - 2 * INSET, height: ENTRY_HEIGHT } } });
    }
    scrollTo().mockClear();
  }

  /** The TV's scroll view reports where it is. */
  async function scrolledTo(offset: number) {
    await fireEvent(scrollView(), "scroll", {
      nativeEvent: { contentOffset: { x: 0, y: offset }, layoutMeasurement: { width: px(sizes.railOpenW), height: VIEWPORT }, contentSize: { width: px(sizes.railOpenW), height: CONTENT } },
    });
    scrollTo().mockClear();
  }

  const lastScroll = () => scrollTo().mock.calls.at(-1)?.[0];

  it("T3-40 item 3: the list does not scroll a focused child flush by itself, and never animates", async () => {
    await renderOverflow();
    expect(scrollView().props.scrollsChildToFocus).toBe(false);
    expect(scrollView().props.scrollAnimationEnabled).toBe(false);
  });

  it("T3-40 item 3: focusing the last library scrolls to the end, so its ring is whole, and Home back to the start", async () => {
    await renderOverflow();
    await focusEntry("rail-entry-library-L14");
    expect(lastScroll()).toEqual(expect.objectContaining({ y: END, animated: false }));
    await scrolledTo(END);
    await focusEntry("rail-entry-home");
    expect(lastScroll()).toEqual(expect.objectContaining({ y: 0, animated: false }));
  });

  it("T3-40 item 3: focusing a library below the view scrolls just far enough to keep its ring's room below it", async () => {
    await renderOverflow();
    await focusEntry("rail-entry-library-L12");
    expect(lastScroll()).toEqual(expect.objectContaining({ y: topOf(12) + ENTRY_HEIGHT + ROOM - VIEWPORT, animated: false }));
  });

  it("T3-40 item 3: focusing a library above the view scrolls just far enough to keep its ring's room above it", async () => {
    await renderOverflow();
    await scrolledTo(END);
    await focusEntry("rail-entry-library-L2");
    expect(lastScroll()).toEqual(expect.objectContaining({ y: topOf(2) - ROOM, animated: false }));
  });

  it("T3-40 item 3: Search puts a half-scrolled list back at the start, so no entry sits under Search's ring", async () => {
    await renderOverflow();
    await scrolledTo(END / 2);
    await focusEntry("rail-entry-search");
    expect(lastScroll()).toEqual(expect.objectContaining({ y: 0, animated: false }));
  });

  it("T3-40 item 3: Settings takes a half-scrolled list to its end, so no part of an entry sits under Settings' ring", async () => {
    await renderOverflow();
    await scrolledTo(END / 2);
    await focusEntry("rail-entry-settings");
    expect(lastScroll()).toEqual(expect.objectContaining({ y: END, animated: false }));
  });
});

describe("T3-40 item 4: a focused entry's ring covers no part of the entry above or below", () => {
  it("T3-40 item 4: every pair of neighbouring entries, across the groups too, is at least the ring's reach apart", async () => {
    await renderRail();
    await focusEntry("rail-entry-home");
    const pairs = ENTRIES.slice(1).map((lower, index) => [ENTRIES[index] as string, lower] as const);
    for (const [upper, lower] of pairs) {
      const apart = spaceBetween(screen.getByTestId(upper), screen.getByTestId(lower));
      expect({ upper, lower, clear: apart >= RING_REACH }).toEqual({ upper, lower, clear: true });
    }
  });

  it("T3-40 item 4: no focused entry grows into its neighbours", async () => {
    await renderRail();
    for (const id of ENTRIES) {
      await focusEntry(id);
      expect({ id, scaled: hasTransform(screen.getByTestId(`${id}-scale`)) }).toEqual({ id, scaled: false });
      await fireEvent(screen.getByTestId(id), "blur", event);
    }
  });
});

describe("T3-40 item 5: the entries sit 16 canvas px from the rail's top, bottom and sides", () => {
  for (const state of ["collapsed", "open"] as const) {
    it(`T3-40 item 5: ${state}, Search is 16 px from the top, the account 16 px from the bottom and every entry 16 px from both sides`, async () => {
      await renderRail();
      if (state === "open") await focusEntry("rail-entry-home");
      const rail = screen.getByTestId("rail");
      expect(roomInside(screen.getByTestId("rail-entry-search"), rail, "Top")).toBe(INSET);
      expect(roomInside(screen.getByTestId("rail-entry-account"), rail, "Bottom")).toBe(INSET);
      for (const id of ENTRIES) {
        const entry = screen.getByTestId(id);
        expect({ id, left: roomInside(entry, rail, "Left"), right: roomInside(entry, rail, "Right") }).toEqual({ id, left: INSET, right: INSET });
      }
    });
  }
});
