// T3-09 review fixes: the rail's way back is cleared on a root switch, the edge guide follows late-loading libraries, and an
// inline `screens` object does not drop the saved focus places.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { BackHandler } from "react-native";
import type { ReactElement } from "react";
import type { LibraryView } from "@octave/core/src/domain/catalog";
import { ReducedMotionProvider } from "../design/motion";
import { AppShell } from "./app-shell";
import { focusView, pointGuide, resetFocusBridge, testIDOf } from "./test-support/focus-bridge-double";
import { resetRouters, routers } from "./test-support/row-router-spy";
import { fixtureAccount, fixtureLibraries, fixtureScreens } from "./test-support/shell-fixtures";

jest.mock("@shopify/flash-list", () => require("../design/rows/test-support/flash-list-double"));
jest.mock("./focus-bridge", () => require("./test-support/focus-bridge-double"));
jest.mock("../design/rows/row-router", () => require("./test-support/row-router-spy"));

const event = { nativeEvent: {} };
type Listener = () => boolean | null | undefined;
let listeners: Listener[] = [];

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
  resetFocusBridge();
  resetRouters();
  listeners = [];
  jest.spyOn(BackHandler, "addEventListener").mockImplementation(((_name: string, handler: Listener) => {
    listeners.push(handler);
    return { remove: () => (listeners = listeners.filter((listener) => listener !== handler)) };
  }) as never);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function shell(libraries: readonly LibraryView[], screens: typeof fixtureScreens, path: string): ReactElement {
  return (
    <ReducedMotionProvider value>
      <AppShell screens={screens} libraries={libraries} account={fixtureAccount} initialPath={path} />
    </ReducedMotionProvider>
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
}

const focus = (id: string) => fireEvent(screen.getByTestId(id), "focus", event);
const rightOf = (id: string) => screen.getByTestId(id).props.nextFocusRight;

describe("T3-09 review fixes", () => {
  it("clears the entries' nextFocusRight when a root switch replaces the screen", async () => {
    await render(shell(fixtureLibraries, fixtureScreens, "/"));
    await settle();
    await focus("home-primary");
    await focus("rail-entry-home");
    expect(rightOf("rail-entry-search")).toBeDefined();
    await fireEvent.press(screen.getByTestId("rail-entry-search"));
    await settle();
    expect(screen.queryAllByTestId("screen-search")).toHaveLength(1);
    expect(rightOf("rail-entry-search")).toBeUndefined();
    expect(rightOf("rail-entry-home")).toBeUndefined();
  });

  it("points the edge guide at a library entry that mounts after the first render", async () => {
    const view = await render(shell([], fixtureScreens, "/library/A"));
    await settle();
    await view.rerender(shell(fixtureLibraries, fixtureScreens, "/library/A"));
    await settle();
    const calls = pointGuide.mock.calls.filter(([guide]) => testIDOf(guide) === "shell-edge");
    const last = calls.at(-1);
    expect(last?.[1]).toHaveLength(1);
    expect(testIDOf(last?.[1][0])).toBe("rail-entry-library-A");
  });

  it("keeps the saved focus place when the caller passes a new screens object on a re-render", async () => {
    const view = await render(shell(fixtureLibraries, { ...fixtureScreens }, "/"));
    await settle();
    await focus("l-row-A-card-3");
    const card = routers().at(-1)!.cardView("A", "A-item-3");
    await fireEvent.press(screen.getByTestId("l-row-A-card-3"));
    await settle();
    await view.rerender(shell(fixtureLibraries, { ...fixtureScreens }, "/"));
    await settle();
    focusView.mockClear();
    await act(async () => {
      listeners.at(-1)?.();
    });
    await settle();
    expect(focusView).toHaveBeenCalledTimes(1);
    expect(focusView.mock.calls[0]?.[0]).toBe(card);
  });
});
