// T3-09 items 1, 2, 4, 5, 6, 7 and 8: the shell as a whole, rendered over the native stack with fixture screens. Jest has no
// focus engine, so no test here moves focus: each checks the structure decision 0004's measured fixes call for, and what the
// shell asks the focus bridge to do. The real moves are milestone 4's emulator evidence and T3-10's run.
//
// A registered view is a mock View instance and is never the object `getByTestId` returns, so a view is named by the testID
// it was rendered with (`testIDOf`). The lower screens of the stack stay mounted but hidden, so a query sees only the top one
// unless it asks for hidden elements.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { BackHandler, StyleSheet } from "react-native";
import type { ReactElement } from "react";
import { ReducedMotionProvider } from "../design/motion";
import { px } from "../design/scale";
import { sizes } from "../design/tokens";
import { AppShell } from "./app-shell";
import { focusView, pointGuide, resetFocusBridge, tagOf, testIDOf } from "./test-support/focus-bridge-double";
import { resetRouters, routers } from "./test-support/row-router-spy";
import { fixtureAccount, fixtureLibraries, fixtureScreens } from "./test-support/shell-fixtures";

jest.mock("@shopify/flash-list", () => require("../design/rows/test-support/flash-list-double"));
jest.mock("./focus-bridge", () => require("./test-support/focus-bridge-double"));
jest.mock("../design/rows/row-router", () => require("./test-support/row-router-spy"));

const event = { nativeEvent: {} };
const ENTRY_IDS = ["search", "home", "library-A", "library-B", "library-C", "settings", "account"].map((key) => `rail-entry-${key}`);

type Listener = () => boolean | null | undefined;
let listeners: Listener[] = [];
let addListener: jest.SpiedFunction<typeof BackHandler.addEventListener>;
let exitApp: jest.SpiedFunction<typeof BackHandler.exitApp>;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
  resetFocusBridge();
  resetRouters();
  listeners = [];
  addListener = jest.spyOn(BackHandler, "addEventListener").mockImplementation(((_name: string, handler: Listener) => {
    listeners.push(handler);
    return {
      remove: () => {
        listeners = listeners.filter((listener) => listener !== handler);
      },
    };
  }) as never);
  exitApp = jest.spyOn(BackHandler, "exitApp").mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function shell(initialPath: string = "/"): ReactElement {
  return (
    <ReducedMotionProvider value>
      <AppShell screens={fixtureScreens} libraries={fixtureLibraries} account={fixtureAccount} initialPath={initialPath} />
    </ReducedMotionProvider>
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
}

async function renderAt(path: string = "/") {
  const view = await render(shell(path));
  await settle();
  return view;
}

const focus = (id: string) => fireEvent(screen.getByTestId(id), "focus", event);
const blur = (id: string) => fireEvent(screen.getByTestId(id), "blur", event);

/** The shell's own Back listener: the last one registered, since React Navigation registers its own first. */
function shellListener(): Listener {
  const listener = listeners.at(-1);
  if (listener === undefined) throw new Error("no Back listener was registered");
  return listener;
}

async function pressBack(): Promise<boolean | null | undefined> {
  let result: boolean | null | undefined;
  await act(async () => {
    result = shellListener()();
  });
  await settle();
  return result;
}

const visibleScreens = (): unknown[] => screen.queryAllByTestId(/^screen-/).map((element) => element.props.testID);
const mountedScreens = (): number => screen.queryAllByTestId(/^screen-/, { includeHiddenElements: true }).length;
const railWidth = (): unknown => (StyleSheet.flatten(screen.getByTestId("rail").props.style) as { width?: unknown } | undefined)?.width;
const labelIds = (): unknown[] => screen.queryAllByTestId(/^rail-entry-.+-label$/).map((element) => element.props.testID);
const entryIdsInOrder = (): unknown[] => screen.queryAllByTestId(/^rail-entry-(search|home|library-[A-Z]|settings|account)$/).map((element) => element.props.testID);
const isSelected = (id: string): boolean => screen.getByTestId(id).props.accessibilityState?.selected === true;
const preferredFocus = (): unknown[] => screen.container.queryAll((instance) => Boolean(instance.props.hasTVPreferredFocus)).map((instance) => instance.props.testID);

/** The testID of the view the edge guide was last pointed at, and how many views that call named. */
function edgeTarget(): { count: number; target: string | undefined } {
  const calls = pointGuide.mock.calls.filter(([guide]) => testIDOf(guide) === "shell-edge");
  const last = calls.at(-1);
  if (last === undefined) return { count: 0, target: undefined };
  return { count: last[1].length, target: testIDOf(last[1][0]) };
}

const homeRouter = () => {
  const found = routers();
  if (found.length === 0) throw new Error("no RowList created a router");
  return found[found.length - 1]!;
};

function allText(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) for (const child of node) allText(child, out);
  else if (node !== null && typeof node === "object") allText((node as { children?: unknown }).children ?? [], out);
  return out;
}

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

describe("T3-09 item 1: the collapsed rail beside every browse screen", () => {
  const BROWSE: { path: string; entry: string }[] = [
    { path: "/", entry: "rail-entry-home" },
    { path: "/search", entry: "rail-entry-search" },
    { path: "/library/A", entry: "rail-entry-library-A" },
    { path: "/settings", entry: "rail-entry-settings" },
    { path: "/accounts", entry: "rail-entry-account" },
  ];

  it("T3-09 item 1: at every browse route the rail is present, railCollapsedW wide, with no label", async () => {
    for (const { path } of BROWSE) {
      const view = await renderAt(path);
      expect(screen.getByTestId("rail")).toBeTruthy();
      expect(railWidth()).toBe(px(sizes.railCollapsedW));
      expect(labelIds()).toEqual([]);
      await view.unmount();
    }
  });

  it("T3-09 item 1: the edge guide is pointed at exactly one view, the current entry's registered view", async () => {
    for (const { path, entry } of BROWSE) {
      resetFocusBridge();
      const view = await renderAt(path);
      expect(screen.getByTestId("shell-edge")).toBeTruthy();
      expect(edgeTarget()).toEqual({ count: 1, target: entry });
      await view.unmount();
    }
  });

  it("T3-09 item 1: the edge guide is pointed at the new current entry when the current entry changes", async () => {
    await renderAt("/");
    expect(edgeTarget().target).toBe("rail-entry-home");
    await fireEvent.press(screen.getByTestId("rail-entry-library-A"));
    await settle();
    expect(edgeTarget()).toEqual({ count: 1, target: "rail-entry-library-A" });
  });

  it("T3-09 item 1: under the shell a row with no leftEdge does not trap Left, so Left from its first card can leave it", async () => {
    await renderAt("/");
    expect(screen.getByTestId("l-row-A-guide").props.trapFocusLeft).toBeFalsy();
    expect(screen.getByTestId("l-row-B-guide").props.trapFocusLeft).toBeFalsy();
    expect(screen.getByTestId("l-row-A-guide").props.trapFocusRight).toBe(true);
  });

  it("T3-09 item 1: focus on rail-entry-home opens the rail to railOpenW with every label, and blur with no other focus closes it", async () => {
    await renderAt("/");
    await focus("rail-entry-home");
    expect(railWidth()).toBe(px(sizes.railOpenW));
    expect(labelIds()).toEqual(ENTRY_IDS.map((id) => `${id}-label`));
    await blur("rail-entry-home");
    await settle();
    expect(railWidth()).toBe(px(sizes.railCollapsedW));
    expect(labelIds()).toEqual([]);
  });
});

describe("T3-09 item 2: Right returns to the content that had focus", () => {
  it("T3-09 item 2: rail-guide traps Left, Up and Down and never Right", async () => {
    await renderAt("/");
    const guide = screen.getByTestId("rail-guide");
    expect(guide.props.trapFocusLeft).toBe(true);
    expect(guide.props.trapFocusUp).toBe(true);
    expect(guide.props.trapFocusDown).toBe(true);
    expect(guide.props.trapFocusRight).toBeFalsy();
  });

  it("T3-09 item 2: before any content focus no entry has a nextFocusRight, even with the rail open", async () => {
    await renderAt("/");
    await focus("rail-entry-home");
    for (const id of ENTRY_IDS) expect(screen.getByTestId(id).props.nextFocusRight).toBeUndefined();
  });

  it("T3-09 item 2: after focus on A-card-3 and then on the rail, every entry's nextFocusRight is the tag of A-card-3's view and of no other card", async () => {
    await renderAt("/");
    await focus("l-row-A-card-3");
    await focus("rail-entry-home");
    const router = homeRouter();
    const v = router.cardView("A", "A-item-3");
    expect(testIDOf(v)).toBe("l-row-A-card-3");
    expect(tagOf(v)).toBeDefined();
    for (const id of ENTRY_IDS) expect(screen.getByTestId(id).props.nextFocusRight).toBe(tagOf(v));
    expect(tagOf(v)).not.toBe(tagOf(router.cardView("A", "A-item-2")));
    expect(tagOf(v)).not.toBe(tagOf(router.cardView("B", "B-item-3")));
  });

  it("T3-09 item 2: the entries have no nextFocusRight once the rail has closed again", async () => {
    await renderAt("/");
    await focus("l-row-A-card-3");
    await focus("rail-entry-home");
    await blur("rail-entry-home");
    await settle();
    for (const id of ENTRY_IDS) expect(screen.getByTestId(id).props.nextFocusRight).toBeUndefined();
  });

  it("T3-09 item 2: pressing the current entry calls focusView once with A-card-3's view itself, and the rail closes", async () => {
    await renderAt("/");
    await focus("l-row-A-card-3");
    await focus("rail-entry-home");
    const v = homeRouter().cardView("A", "A-item-3");
    focusView.mockClear();
    await fireEvent.press(screen.getByTestId("rail-entry-home"));
    await settle();
    expect(focusView).toHaveBeenCalledTimes(1);
    expect(focusView.mock.calls[0]?.[0]).toBe(v);
    expect(railWidth()).toBe(px(sizes.railCollapsedW));
  });
});

describe("T3-09 item 3: the rail's order does not change between visits", () => {
  it("T3-09 item 3: the shell's rail lists search, home, the libraries in the server's order, settings and the account", async () => {
    await renderAt("/");
    expect(entryIdsInOrder()).toEqual(ENTRY_IDS);
  });

  it("T3-09 item 3: pressing a library entry makes that library the top route with the stack reset to it, and the order is unchanged", async () => {
    await renderAt("/");
    await fireEvent.press(screen.getByTestId("rail-entry-library-A"));
    await settle();
    expect(visibleScreens()).toEqual(["screen-library"]);
    expect(mountedScreens()).toBe(1);
    expect(entryIdsInOrder()).toEqual(ENTRY_IDS);
    for (const id of ENTRY_IDS) {
      expect(isSelected(id)).toBe(id === "rail-entry-library-A");
      expect(screen.queryByTestId(`${id}-bar`) !== null).toBe(id === "rail-entry-library-A");
    }
  });

  it("T3-09 item 3: unmounting the shell and mounting a new one with the same libraries gives the same order", async () => {
    const first = await renderAt("/");
    const before = entryIdsInOrder();
    await first.unmount();
    await renderAt("/library/B");
    expect(entryIdsInOrder()).toEqual(before);
    expect(isSelected("rail-entry-library-B")).toBe(true);
  });
});

describe("T3-09 item 4: opening focus and the return from a pushed screen", () => {
  it("T3-09 item 4: at every root path exactly one element has hasTVPreferredFocus, the fixture screen's primary action", async () => {
    for (const [path, kind] of [
      ["/", "home"],
      ["/search", "search"],
      ["/library/A", "library"],
      ["/settings", "settings"],
      ["/accounts", "accounts"],
    ] as const) {
      const view = await renderAt(path);
      expect(preferredFocus()).toEqual([`${kind}-primary`]);
      await view.unmount();
    }
  });

  it("T3-09 item 4: Back from an opened item returns to Home and focuses the card that opened it, once, through the same view", async () => {
    await renderAt("/");
    await focus("l-row-A-card-3");
    const v = homeRouter().cardView("A", "A-item-3");
    expect(testIDOf(v)).toBe("l-row-A-card-3");
    await fireEvent.press(screen.getByTestId("l-row-A-card-3"));
    await settle();
    expect(visibleScreens()).toEqual(["screen-item"]);
    focusView.mockClear();
    expect(await pressBack()).toBe(true);
    expect(visibleScreens()).toEqual(["screen-home"]);
    expect(mountedScreens()).toBe(1);
    expect(focusView).toHaveBeenCalledTimes(1);
    expect(focusView.mock.calls[0]?.[0]).toBe(v);
  });

  it("T3-09 item 4: a card deeper in the second row is the one focused when Back returns", async () => {
    await renderAt("/");
    await focus("l-row-A-card-3");
    await focus("l-row-B-card-5");
    await fireEvent.press(screen.getByTestId("l-row-B-card-5"));
    await settle();
    focusView.mockClear();
    await pressBack();
    expect(focusView).toHaveBeenCalledTimes(1);
    expect(focusView.mock.calls[0]?.[0]).toBe(homeRouter().cardView("B", "B-item-5"));
  });
});

describe("T3-09 item 5: Back", () => {
  it("T3-09 item 5: the first Back at / with the rail closed opens the rail on Home's entry and does not leave", async () => {
    await renderAt("/");
    focusView.mockClear();
    expect(await pressBack()).toBe(true);
    expect(focusView).toHaveBeenCalledTimes(1);
    expect(testIDOf(focusView.mock.calls[0]?.[0])).toBe("rail-entry-home");
    expect(exitApp).not.toHaveBeenCalled();
    expect(visibleScreens()).toEqual(["screen-home"]);
  });

  it("T3-09 item 5: Back on Home with the rail open leaves the app, synchronously, with no dialog and no question", async () => {
    await renderAt("/");
    await focus("rail-entry-home");
    const textBefore = allText(screen.toJSON());
    expect(dialogLike(screen.toJSON())).toEqual([]);
    let result: boolean | null | undefined;
    let exitCallsWhenItReturned = -1;
    await act(async () => {
      result = shellListener()();
      exitCallsWhenItReturned = exitApp.mock.calls.length;
    });
    expect(result).toBe(true);
    expect(exitCallsWhenItReturned).toBe(1);
    await settle();
    expect(exitApp).toHaveBeenCalledTimes(1);
    expect(dialogLike(screen.toJSON())).toEqual([]);
    expect(allText(screen.toJSON())).toEqual(textBefore);
  });

  it("T3-09 item 5: leaving from Home's content takes two presses: the first opens the rail, the second exits", async () => {
    await renderAt("/");
    await pressBack();
    expect(exitApp).not.toHaveBeenCalled();
    await focus("rail-entry-home");
    await pressBack();
    expect(exitApp).toHaveBeenCalledTimes(1);
  });

  it("T3-09 item 5: Back on another root screen with the rail open goes Home with a stack of one, and does not leave", async () => {
    await renderAt("/library/A");
    await focus("rail-entry-library-A");
    expect(await pressBack()).toBe(true);
    expect(visibleScreens()).toEqual(["screen-home"]);
    expect(mountedScreens()).toBe(1);
    expect(exitApp).not.toHaveBeenCalled();
  });

  it("T3-09 item 5: Back on another root screen with the rail closed opens the rail on that screen's entry and stays", async () => {
    await renderAt("/settings");
    focusView.mockClear();
    expect(await pressBack()).toBe(true);
    expect(focusView).toHaveBeenCalledTimes(1);
    expect(testIDOf(focusView.mock.calls[0]?.[0])).toBe("rail-entry-settings");
    expect(visibleScreens()).toEqual(["screen-settings"]);
    expect(exitApp).not.toHaveBeenCalled();
  });

  it("T3-09 item 5: Back on the not-found state goes Home", async () => {
    await renderAt("/nope");
    expect(await pressBack()).toBe(true);
    expect(visibleScreens()).toEqual(["screen-home"]);
    expect(exitApp).not.toHaveBeenCalled();
  });

  it("T3-09 item 5: the shell's listener is the last one registered and is registered once, however the rail and routes change", async () => {
    await renderAt("/");
    const registrations = addListener.mock.calls.length;
    const first = shellListener();
    await focus("rail-entry-home");
    await blur("rail-entry-home");
    await settle();
    await focus("rail-entry-library-A");
    await fireEvent.press(screen.getByTestId("rail-entry-library-A"));
    await blur("rail-entry-library-A");
    await settle();
    await pressBack();
    expect(visibleScreens()).toEqual(["screen-library"]);
    expect(addListener.mock.calls.length).toBe(registrations);
    expect(shellListener()).toBe(first);
  });
});

describe("T3-09 item 6: no rail in the player or during sign-in", () => {
  it("T3-09 item 6: at /play/item-1 and /sign-in there is no rail, no rail guide and no edge guide", async () => {
    for (const [path, kind] of [
      ["/play/item-1", "screen-play"],
      ["/sign-in", "screen-signIn"],
    ] as const) {
      const view = await renderAt(path);
      expect(visibleScreens()).toEqual([kind]);
      expect(screen.queryByTestId("rail")).toBeNull();
      expect(screen.queryByTestId("rail-guide")).toBeNull();
      expect(screen.queryByTestId("shell-edge")).toBeNull();
      await view.unmount();
    }
  });

  it("T3-09 item 6: opening the player from Home removes the rail, and Back pops and brings it back", async () => {
    await renderAt("/");
    expect(screen.getByTestId("rail")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("home-primary"));
    await settle();
    expect(visibleScreens()).toEqual(["screen-play"]);
    expect(screen.queryByTestId("rail")).toBeNull();
    expect(screen.queryByTestId("rail-guide")).toBeNull();
    expect(screen.queryByTestId("shell-edge")).toBeNull();
    expect(await pressBack()).toBe(true);
    expect(visibleScreens()).toEqual(["screen-home"]);
    expect(screen.getByTestId("rail")).toBeTruthy();
    expect(screen.getByTestId("rail-guide")).toBeTruthy();
    expect(screen.getByTestId("shell-edge")).toBeTruthy();
    expect(exitApp).not.toHaveBeenCalled();
  });
});

describe("T3-09 item 7: an unknown route shows the not-found state", () => {
  it("T3-09 item 7: initialPath /nope renders not-found with no fixture screen, the rail on Home, and Go home focused first", async () => {
    await renderAt("/nope");
    expect(screen.getByTestId("not-found")).toBeTruthy();
    expect(visibleScreens()).toEqual([]);
    expect(screen.getByTestId("rail")).toBeTruthy();
    for (const id of ENTRY_IDS) expect(isSelected(id)).toBe(id === "rail-entry-home");
    expect(screen.getByTestId("not-found-home").props.hasTVPreferredFocus).toBe(true);
    expect(preferredFocus()).toEqual(["not-found-home"]);
  });

  it("T3-09 item 7: pressing Go home makes home the top route with a stack of one", async () => {
    await renderAt("/nope");
    await fireEvent.press(screen.getByTestId("not-found-home"));
    await settle();
    expect(visibleScreens()).toEqual(["screen-home"]);
    expect(mountedScreens()).toBe(1);
    expect(screen.queryByTestId("not-found")).toBeNull();
  });

  it("T3-09 item 7: a path with a query or an id outside the allowed set is not-found too", async () => {
    for (const path of ["/library/A?x=1", "/item/a b", ""]) {
      const view = await renderAt(path);
      expect(screen.getByTestId("not-found")).toBeTruthy();
      expect(visibleScreens()).toEqual([]);
      await view.unmount();
    }
  });
});

describe("T3-09 item 8: Right from the rail returns to the card that had focus, even after the rows' router pointed the guides elsewhere", () => {
  it("T3-09 item 8: entering the rail after focus moved from A-card-3 to B-card-5 clears the rows' guides and returns to B-card-5", async () => {
    await renderAt("/");
    await focus("l-row-A-card-3");
    const router = homeRouter();
    const callsBefore = router.destinationCalls("A").length;
    await focus("l-row-B-card-5");
    const pointed = router.destinationCalls("A").slice(callsBefore);
    expect(pointed.some((list) => list.length === 1)).toBe(true);
    expect(router.clear).not.toHaveBeenCalled();

    await focus("rail-entry-home");
    expect(router.clear).toHaveBeenCalledTimes(1);
    expect(router.guideRows().sort()).toEqual(["A", "B"]);
    for (const rowId of router.guideRows()) expect(router.destinationCalls(rowId).at(-1)).toEqual([]);

    const w = router.cardView("B", "B-item-5");
    expect(testIDOf(w)).toBe("l-row-B-card-5");
    for (const id of ENTRY_IDS) expect(screen.getByTestId(id).props.nextFocusRight).toBe(tagOf(w));
    expect(tagOf(w)).not.toBe(tagOf(router.cardView("A", "A-item-3")));

    focusView.mockClear();
    await fireEvent.press(screen.getByTestId("rail-entry-home"));
    await settle();
    expect(focusView).toHaveBeenCalledTimes(1);
    expect(focusView.mock.calls[0]?.[0]).toBe(w);
  });
});
