// T3-08 items 1, 2, 4 and 5: the structure of a row that keeps focus where the viewer pressed (decision 0004's measured
// fixes), as far as Jest can hold it. Jest has no focus engine, so the real moves are the milestone 5 emulator evidence
// and T3-10's run. FlashList is replaced by the double in ./test-support.
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import type { TestInstance } from "test-renderer";
import { px } from "../scale";
import { sizes, space } from "../tokens";
import { ReducedMotionProvider } from "../motion";
import { ROW_DRAW_DISTANCE } from "./row-geometry";
import { MediaRow } from "./media-row";
import { RowList } from "./row-list";
import { createRowMemory } from "./row-memory";
import type { RowMemory } from "./row-memory";
import { fixtureItems } from "./test-support/fixtures";
import { resetScrollCalls, scrollCalls } from "./test-support/flash-list-double";

jest.mock("@shopify/flash-list", () => require("./test-support/flash-list-double"));

const event = { nativeEvent: {} };
/** Item 1 pins the poster row's draw distance, measured clean at 0 of 12 bursts (decision 0004 addendum), in dp. */
const MEASURED_POSTER_DRAW_DISTANCE = 150;
/** A scroll offset in dp that is far from 0: ten poster strides. */
const SCROLLED = px(sizes.posterW + space.space5) * 10;
const SCROLL_EVENT = { nativeEvent: { contentOffset: { x: SCROLLED, y: 0 } } };

beforeEach(() => {
  resetScrollCalls();
});

type RowProps = {
  rowId?: string;
  variant?: "poster" | "thumb";
  count?: number;
  memory?: RowMemory;
  leftEdge?: "trap" | "open";
  onCardFocus?: (rowId: string, index: number) => void;
  onCardBlur?: (rowId: string, index: number) => void;
};

function row({ rowId = "row-a", variant = "poster", count = 50, memory = createRowMemory(), leftEdge, onCardFocus, onCardBlur }: RowProps = {}): ReactElement {
  return (
    <MediaRow
      testID="r"
      rowId={rowId}
      title={`Title of ${rowId}`}
      variant={variant}
      items={fixtureItems(rowId, count)}
      memory={memory}
      leftEdge={leftEdge}
      onCardFocus={onCardFocus}
      onCardBlur={onCardBlur}
    />
  );
}

/** Rerenders must keep the provider, so every render goes through this. */
function wrap(ui: ReactElement): ReactElement {
  return <ReducedMotionProvider value>{ui}</ReducedMotionProvider>;
}

function focusableIds(root: TestInstance): unknown[] {
  return root.queryAll((instance) => instance.props.focusable === true).map((instance) => instance.props.testID);
}

const NEXT_FOCUS_PROPS = ["nextFocusLeft", "nextFocusRight", "nextFocusUp", "nextFocusDown"];

describe("T3-08 item 1: a row moves one card per press", () => {
  it("T3-08 item 1: a row of 50 cards has exactly 50 focusable elements, r-card-0 to r-card-49 in order, and nothing else under it takes focus", async () => {
    await render(wrap(row()));
    const expected = Array.from({ length: 50 }, (_, i) => `r-card-${i}`);
    expect(focusableIds(screen.getByTestId("r"))).toEqual(expected);
  });

  it("T3-08 item 1: no element in the row sets nextFocusLeft, nextFocusRight, nextFocusUp or nextFocusDown", async () => {
    await render(wrap(row()));
    const withOverride = screen.getByTestId("r").queryAll((instance) => NEXT_FOCUS_PROPS.some((name) => instance.props[name] !== undefined));
    expect(withOverride).toEqual([]);
    for (let i = 0; i < 50; i += 1) {
      for (const name of NEXT_FOCUS_PROPS) expect(screen.getByTestId(`r-card-${i}`).props[name]).toBeUndefined();
    }
  });

  it("T3-08 item 1: a poster row's list is horizontal, draws 150 dp ahead and has maintainVisibleContentPosition disabled", async () => {
    await render(wrap(row({ variant: "poster" })));
    const list = screen.getByTestId("r-list");
    expect(list.props.horizontal).toBe(true);
    expect(list.props.drawDistance).toBe(MEASURED_POSTER_DRAW_DISTANCE);
    expect(list.props.maintainVisibleContentPosition?.disabled).toBe(true);
  });

  it("T3-08 item 1: a thumb row's list is horizontal, has maintainVisibleContentPosition disabled and a draw distance of at least ROW_DRAW_DISTANCE", async () => {
    await render(wrap(row({ variant: "thumb" })));
    const list = screen.getByTestId("r-list");
    expect(list.props.horizontal).toBe(true);
    expect(list.props.maintainVisibleContentPosition?.disabled).toBe(true);
    expect(typeof list.props.drawDistance).toBe("number");
    expect(list.props.drawDistance).toBeGreaterThanOrEqual(ROW_DRAW_DISTANCE);
  });

  it("T3-08 item 1: focusing r-card-0 to r-card-49 in turn calls onCardFocus 50 times with (rowId, 0) to (rowId, 49), the last being (rowId, 49)", async () => {
    const onCardFocus = jest.fn();
    await render(wrap(row({ onCardFocus })));
    for (let i = 0; i < 50; i += 1) await fireEvent(screen.getByTestId(`r-card-${i}`), "focus", event);
    expect(onCardFocus).toHaveBeenCalledTimes(50);
    expect(onCardFocus.mock.calls).toEqual(Array.from({ length: 50 }, (_, i) => ["row-a", i]));
    expect(onCardFocus.mock.calls.at(-1)).toEqual(["row-a", 49]);
  });
});

describe("T3-08 item 2: a row's ends hold focus", () => {
  it("T3-08 item 2: the row's guide traps Right, and traps Left by default and with leftEdge trap", async () => {
    await render(wrap(row()));
    expect(screen.getByTestId("r-guide").props.trapFocusRight).toBe(true);
    expect(screen.getByTestId("r-guide").props.trapFocusLeft).toBe(true);
  });

  it("T3-08 item 2: with leftEdge trap the guide traps Left", async () => {
    await render(wrap(row({ leftEdge: "trap" })));
    expect(screen.getByTestId("r-guide").props.trapFocusRight).toBe(true);
    expect(screen.getByTestId("r-guide").props.trapFocusLeft).toBe(true);
  });

  it("T3-08 item 2: with leftEdge open the guide still traps Right and has no truthy trapFocusLeft", async () => {
    await render(wrap(row({ leftEdge: "open" })));
    expect(screen.getByTestId("r-guide").props.trapFocusRight).toBe(true);
    expect(screen.getByTestId("r-guide").props.trapFocusLeft).toBeFalsy();
  });

  it("T3-08 item 2: in every case the guide traps neither Up nor Down", async () => {
    for (const leftEdge of [undefined, "trap", "open"] as const) {
      const view = await render(wrap(row({ leftEdge })));
      expect(screen.getByTestId("r-guide").props.trapFocusUp).toBeFalsy();
      expect(screen.getByTestId("r-guide").props.trapFocusDown).toBeFalsy();
      await view.unmount();
    }
  });

  it("T3-08 item 2: after r-card-0 takes focus the list's last scrollToOffset call is { offset: 0, animated: false }", async () => {
    await render(wrap(row()));
    await fireEvent(screen.getByTestId("r-card-3"), "focus", event);
    await fireEvent(screen.getByTestId("r-card-0"), "focus", event);
    const calls = scrollCalls("r-list");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.at(-1)).toEqual({ offset: 0, animated: false });
  });
});

describe("T3-08 item 4: each row remembers its own scroll position", () => {
  it("T3-08 item 4: a row given another row id restores that id's offset, and 0 for a row never scrolled", async () => {
    const memory = createRowMemory();
    const view = await render(wrap(row({ rowId: "row-a", memory })));
    await fireEvent.scroll(screen.getByTestId("r-list"), SCROLL_EVENT);
    await view.rerender(wrap(row({ rowId: "row-b", memory })));
    expect(scrollCalls("r-list").at(-1)).toEqual({ offset: 0, animated: false });
    await view.rerender(wrap(row({ rowId: "row-a", memory })));
    expect(scrollCalls("r-list").at(-1)).toEqual({ offset: SCROLLED, animated: false });
    expect(memory.get("row-a")).toBe(SCROLLED);
    expect(memory.get("row-b")).toBe(0);
  });

  it("T3-08 item 4: a new MediaRow for a row with a remembered offset above 0 restores it on mount", async () => {
    const memory = createRowMemory();
    const first = await render(wrap(row({ rowId: "row-a", memory })));
    await fireEvent.scroll(screen.getByTestId("r-list"), SCROLL_EVENT);
    await first.unmount();
    resetScrollCalls();
    await render(wrap(row({ rowId: "row-a", memory })));
    expect(scrollCalls("r-list").at(-1)).toEqual({ offset: SCROLLED, animated: false });
  });

  it("T3-08 item 4: two separate RowMemory objects do not share offsets", async () => {
    const one = createRowMemory();
    const two = createRowMemory();
    one.set("row-a", SCROLLED);
    expect(one.get("row-a")).toBe(SCROLLED);
    expect(two.get("row-a")).toBe(0);
    expect(two.get("never-seen")).toBe(0);
    const first = await render(wrap(row({ rowId: "row-a", memory: one })));
    await first.unmount();
    resetScrollCalls();
    await render(wrap(row({ rowId: "row-a", memory: two })));
    expect(scrollCalls("r-list").filter((call) => (call as { offset: number }).offset !== 0)).toEqual([]);
  });
});

describe("T3-08 item 5: a focused card is never recycled under the viewer", () => {
  it("T3-08 item 5: the list has maintainVisibleContentPosition disabled", async () => {
    await render(wrap(row()));
    expect(screen.getByTestId("r-list").props.maintainVisibleContentPosition?.disabled).toBe(true);
  });

  it("T3-08 item 5: the list keys cards by item id, never by index", async () => {
    await render(wrap(row({ count: 10 })));
    const keyExtractor = screen.getByTestId("r-list").props.keyExtractor as (item: unknown, index: number) => string;
    const items = fixtureItems("row-a", 10);
    expect(keyExtractor(items[3], 3)).toBe(items[3].id);
    expect(keyExtractor(items[3], 7)).toBe(items[3].id);
    expect(keyExtractor(items[4], 4)).not.toBe(keyExtractor(items[3], 3));
  });

  it("T3-08 item 5: the row list keys rows by row id and types them by variant", async () => {
    const rows = [
      { id: "alpha", title: "Alpha", variant: "poster" as const, items: fixtureItems("alpha", 3) },
      { id: "beta", title: "Beta", variant: "thumb" as const, items: fixtureItems("beta", 3) },
    ];
    await render(wrap(<RowList testID="l" rows={rows} memory={createRowMemory()} />));
    const list = screen.getByTestId("l-list");
    for (const spec of rows) {
      expect(list.props.keyExtractor(spec, 0)).toBe(spec.id);
      expect(list.props.getItemType(spec, 0)).toBe(spec.variant);
    }
  });

  it("T3-08 item 5: a focus then a blur on r-card-3 report (rowA, 3) and then (rowA, 3), the blur coming after its focus", async () => {
    const log: [string, string, number][] = [];
    const onCardFocus = jest.fn((rowId: string, index: number) => log.push(["focus", rowId, index]));
    const onCardBlur = jest.fn((rowId: string, index: number) => log.push(["blur", rowId, index]));
    await render(wrap(row({ rowId: "row-a", onCardFocus, onCardBlur })));
    await fireEvent(screen.getByTestId("r-card-3"), "focus", event);
    await fireEvent(screen.getByTestId("r-card-3"), "blur", event);
    expect(onCardFocus).toHaveBeenCalledWith("row-a", 3);
    expect(onCardBlur).toHaveBeenCalledWith("row-a", 3);
    expect(log).toEqual([
      ["focus", "row-a", 3],
      ["blur", "row-a", 3],
    ]);
    log.forEach(([kind, rowId, index], at) => {
      if (kind === "blur") expect(log.slice(0, at).some(([k, r, i]) => k === "focus" && r === rowId && i === index)).toBe(true);
    });
  });

  it("T3-08 item 5: after the same instance is given row B, a blur on r-card-3 names (rowB, 3), the card shown now", async () => {
    const onCardBlur = jest.fn();
    const view = await render(wrap(row({ rowId: "row-a", onCardBlur })));
    await fireEvent(screen.getByTestId("r-card-3"), "focus", event);
    await view.rerender(wrap(row({ rowId: "row-b", onCardBlur })));
    await fireEvent(screen.getByTestId("r-card-3"), "blur", event);
    expect(onCardBlur).toHaveBeenLastCalledWith("row-b", 3);
  });
});
