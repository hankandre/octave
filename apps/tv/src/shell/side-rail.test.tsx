// T3-09 items 1, 2 and 3: the structure of the collapsed side rail that decision 0004's measured fixes call for, as far as
// Jest can hold it. Jest has no focus engine, so the real moves are milestone 4's emulator evidence and T3-10's run.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import type { ReactElement } from "react";
import type { TestInstance } from "test-renderer";
import { ReducedMotionProvider } from "../design/motion";
import { px } from "../design/scale";
import { sizes } from "../design/tokens";
import { railEntries } from "./rail-entries";
import type { RailEntry, RailKey } from "./rail-entries";
import { SideRail } from "./side-rail";
import { resetFocusBridge, testIDOf } from "./test-support/focus-bridge-double";
import { fixtureAccount, fixtureLibraries, libraryA, libraryB, libraryC } from "./test-support/shell-fixtures";

jest.mock("./focus-bridge", () => require("./test-support/focus-bridge-double"));

const event = { nativeEvent: {} };
const ENTRY_IDS = ["search", "home", "library-A", "library-B", "library-C", "settings", "account"].map((key) => `rail-entry-${key}`);
const ENTRY_ORDER = ["search", "home", "library:A", "library:B", "library:C", "settings", "account"];
const LABELS: Record<string, string> = {
  "rail-entry-search": "Search",
  "rail-entry-home": "Home",
  "rail-entry-library-A": "Films",
  "rail-entry-library-B": "Shows",
  "rail-entry-library-C": "Sets",
  "rail-entry-settings": "Settings",
  "rail-entry-account": "Jo",
};

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
  resetFocusBridge();
});
afterEach(() => {
  jest.useRealTimers();
});

type RailProps = {
  entries?: RailEntry[];
  current?: RailKey;
  returnTag?: number;
  onSelect?: (entry: RailEntry) => void;
  onOpenChange?: (open: boolean) => void;
  registerEntry?: (key: RailKey, view: unknown) => void;
};

function rail({ entries = railEntries(fixtureLibraries, fixtureAccount), current = "home", returnTag, onSelect = jest.fn(), onOpenChange = jest.fn(), registerEntry = jest.fn() }: RailProps = {}): ReactElement {
  return (
    <ReducedMotionProvider value>
      <SideRail testID="rail" entries={entries} current={current} returnTag={returnTag} onSelect={onSelect} onOpenChange={onOpenChange} registerEntry={registerEntry} />
    </ReducedMotionProvider>
  );
}

const widthOf = (element: TestInstance): unknown => (StyleSheet.flatten(element.props.style) as { width?: unknown } | undefined)?.width;
const labelIds = (): unknown[] => screen.queryAllByTestId(/^rail-entry-.+-label$/).map((element) => element.props.testID);
const textOf = (element: TestInstance): string => element.children.map((child) => (typeof child === "string" ? child : "")).join("");
const entryIdsInOrder = (): unknown[] => screen.queryAllByTestId(/^rail-entry-(search|home|library-[A-Z]|settings|account)$/).map((element) => element.props.testID);

async function settle(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(50);
  });
}

describe("T3-09 item 1: the rail opens when an entry takes focus and closes when focus leaves every entry", () => {
  it("T3-09 item 1: collapsed, the rail is railCollapsedW wide and no entry shows a label", async () => {
    await render(rail());
    expect(widthOf(screen.getByTestId("rail"))).toBe(px(sizes.railCollapsedW));
    expect(labelIds()).toEqual([]);
  });

  it("T3-09 item 1: focus on rail-entry-home makes the rail railOpenW wide in the same render, and every entry shows its label", async () => {
    const onOpenChange = jest.fn();
    await render(rail({ onOpenChange }));
    await fireEvent(screen.getByTestId("rail-entry-home"), "focus", event);
    expect(widthOf(screen.getByTestId("rail"))).toBe(px(sizes.railOpenW));
    expect(labelIds()).toEqual(ENTRY_IDS.map((id) => `${id}-label`));
    for (const id of ENTRY_IDS) expect(textOf(screen.getByTestId(`${id}-label`))).toBe(LABELS[id]);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("T3-09 item 1: blur on the entry with no other focus closes the rail after the zero-delay check", async () => {
    const onOpenChange = jest.fn();
    await render(rail({ onOpenChange }));
    await fireEvent(screen.getByTestId("rail-entry-home"), "focus", event);
    await fireEvent(screen.getByTestId("rail-entry-home"), "blur", event);
    await settle();
    expect(widthOf(screen.getByTestId("rail"))).toBe(px(sizes.railCollapsedW));
    expect(labelIds()).toEqual([]);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("T3-09 item 1: focus moving from one entry to another keeps the rail open", async () => {
    await render(rail());
    await fireEvent(screen.getByTestId("rail-entry-home"), "focus", event);
    await fireEvent(screen.getByTestId("rail-entry-home"), "blur", event);
    await fireEvent(screen.getByTestId("rail-entry-library-A"), "focus", event);
    await settle();
    expect(widthOf(screen.getByTestId("rail"))).toBe(px(sizes.railOpenW));
    await fireEvent(screen.getByTestId("rail-entry-library-A"), "blur", event);
    await settle();
    expect(widthOf(screen.getByTestId("rail"))).toBe(px(sizes.railCollapsedW));
  });
});

describe("T3-09 item 2: Left on the rail stays on the rail, and Right returns to the content", () => {
  it("T3-09 item 2: rail-guide traps Left, Up and Down and never Right", async () => {
    await render(rail());
    const guide = screen.getByTestId("rail-guide");
    expect(guide.props.trapFocusLeft).toBe(true);
    expect(guide.props.trapFocusUp).toBe(true);
    expect(guide.props.trapFocusDown).toBe(true);
    expect(guide.props.trapFocusRight).toBeFalsy();
  });

  it("T3-09 item 2: with no return tag no entry has a nextFocusRight, open or closed", async () => {
    await render(rail());
    for (const id of ENTRY_IDS) expect(screen.getByTestId(id).props.nextFocusRight).toBeUndefined();
    await fireEvent(screen.getByTestId("rail-entry-home"), "focus", event);
    for (const id of ENTRY_IDS) expect(screen.getByTestId(id).props.nextFocusRight).toBeUndefined();
  });

  it("T3-09 item 2: with a return tag, every entry's nextFocusRight is that tag while the rail is open and undefined while it is closed", async () => {
    await render(rail({ returnTag: 1234 }));
    for (const id of ENTRY_IDS) expect(screen.getByTestId(id).props.nextFocusRight).toBeUndefined();
    await fireEvent(screen.getByTestId("rail-entry-home"), "focus", event);
    for (const id of ENTRY_IDS) expect(screen.getByTestId(id).props.nextFocusRight).toBe(1234);
    await fireEvent(screen.getByTestId("rail-entry-home"), "blur", event);
    await settle();
    for (const id of ENTRY_IDS) expect(screen.getByTestId(id).props.nextFocusRight).toBeUndefined();
  });
});

describe("T3-09 item 3: the rail's entries and their order", () => {
  it("T3-09 item 3: the entries appear in the order search, home, libraries in the server's order, settings, account", async () => {
    await render(rail());
    expect(entryIdsInOrder()).toEqual(ENTRY_IDS);
  });

  it("T3-09 item 3: a library order that is not alphabetical is kept as given", async () => {
    await render(rail({ entries: railEntries([libraryC, libraryA, libraryB], fixtureAccount) }));
    expect(entryIdsInOrder()).toEqual(["rail-entry-search", "rail-entry-home", "rail-entry-library-C", "rail-entry-library-A", "rail-entry-library-B", "rail-entry-settings", "rail-entry-account"]);
  });

  it("T3-09 item 3: pressing another entry calls onSelect with that entry, and the order is the same after the rail is given another current entry", async () => {
    const onSelect = jest.fn<(entry: RailEntry) => void>();
    const view = await render(rail({ onSelect }));
    await fireEvent.press(screen.getByTestId("rail-entry-library-A"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const entry = onSelect.mock.calls[0]?.[0];
    expect(entry?.key).toBe("library:A");
    expect(entry?.route).toEqual({ kind: "library", id: "A" });
    await view.rerender(rail({ onSelect, current: "library:A" }));
    expect(entryIdsInOrder()).toEqual(ENTRY_IDS);
  });

  it("T3-09 item 3: only the current entry is selected and has a bar", async () => {
    const view = await render(rail({ current: "home" }));
    for (const id of ENTRY_IDS) {
      const selected = id === "rail-entry-home";
      expect(screen.getByTestId(id).props.accessibilityState?.selected === true).toBe(selected);
      expect(screen.queryByTestId(`${id}-bar`) !== null).toBe(selected);
    }
    await view.rerender(rail({ current: "library:A" }));
    for (const id of ENTRY_IDS) {
      const selected = id === "rail-entry-library-A";
      expect(screen.getByTestId(id).props.accessibilityState?.selected === true).toBe(selected);
      expect(screen.queryByTestId(`${id}-bar`) !== null).toBe(selected);
    }
  });

  it("T3-09 item 3: the rail is a navigation region labelled Main", async () => {
    await render(rail());
    const region = screen.getByTestId("rail");
    expect(region.props.role).toBe("navigation");
    expect(region.props.accessibilityLabel).toBe("Main");
  });

  it("T3-09 item 3: the account entry shows J for the account name Jo when collapsed, and Jo when open", async () => {
    await render(rail());
    expect(within(screen.getByTestId("rail-entry-account")).getByText("J")).toBeTruthy();
    await fireEvent(screen.getByTestId("rail-entry-account"), "focus", event);
    expect(textOf(screen.getByTestId("rail-entry-account-label"))).toBe("Jo");
  });

  it("T3-09 item 3: with no account the account entry shows no initial and, open, the label Who's watching?", async () => {
    await render(rail({ entries: railEntries(fixtureLibraries) }));
    expect(within(screen.getByTestId("rail-entry-account")).queryByText("J")).toBeNull();
    await fireEvent(screen.getByTestId("rail-entry-account"), "focus", event);
    expect(textOf(screen.getByTestId("rail-entry-account-label"))).toBe("Who's watching?");
  });

  it("T3-09 item 3: each entry registers its own Pressable under its key", async () => {
    const registerEntry = jest.fn<(key: RailKey, view: unknown) => void>();
    await render(rail({ registerEntry }));
    const latest = new Map<string, unknown>();
    for (const [key, view] of registerEntry.mock.calls) {
      if (view !== null && view !== undefined) latest.set(key, view);
    }
    expect([...latest.keys()].sort()).toEqual([...ENTRY_ORDER].sort());
    for (const [key, view] of latest) expect(testIDOf(view)).toBe(`rail-entry-${key.replace(":", "-")}`);
  });
});
