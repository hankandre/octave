// T3-43 item 1: the rail's own focus guide (`rail-guide`) is pointed at the current screen's entry, so Left from any control
// in a screen's first column lands on it. Jest has no focus engine, so no test here moves focus: each checks the
// precondition, which guide is pointed at which view. The moves are the task's emulator evidence.
//
// Only calls on `rail-guide` count here; the shell's edge guide is T3-09's.
//
// `FocusFrame` is the real one, wrapped so that a test can remount one control: its view registers again while the rail's
// current entry and entries stay as they are.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { BackHandler } from "react-native";
import type { ReactElement } from "react";
import { ReducedMotionProvider } from "../design/motion";
import { AppShell } from "./app-shell";
import { railEntries, type RailEntry, type RailKey } from "./rail-entries";
import { SideRail } from "./side-rail";
import { pointGuide, resetFocusBridge, testIDOf } from "./test-support/focus-bridge-double";
import { resetRouters } from "./test-support/row-router-spy";
import { fixtureAccount, fixtureLibraries, fixtureScreens } from "./test-support/shell-fixtures";

jest.mock("@shopify/flash-list", () => require("../design/rows/test-support/flash-list-double"));
jest.mock("./focus-bridge", () => require("./test-support/focus-bridge-double"));
jest.mock("../design/rows/row-router", () => require("./test-support/row-router-spy"));
jest.mock("../design/focus-frame", () => {
  const actual = jest.requireActual<typeof import("../design/focus-frame")>("../design/focus-frame");
  const react = jest.requireActual<typeof import("react")>("react");
  const remounts = new Map<string, () => void>();
  function RemountableFocusFrame(props: import("../design/focus-frame").FocusFrameProps) {
    const [generation, setGeneration] = react.useState(0);
    const id = props.testID;
    react.useEffect(() => {
      if (id !== undefined) remounts.set(id, () => setGeneration((previous) => previous + 1));
    }, [id]);
    return react.createElement(actual.FocusFrame, { ...props, key: generation });
  }
  return { ...actual, FocusFrame: RemountableFocusFrame, remountFrame: (id: string) => remounts.get(id)?.() };
});

const { remountFrame } = jest.requireMock<{ remountFrame(id: string): void }>("../design/focus-frame");

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

async function settle(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
}

async function renderShellAt(path: string) {
  const view = await render(
    <ReducedMotionProvider value>
      <AppShell screens={fixtureScreens} libraries={fixtureLibraries} account={fixtureAccount} initialPath={path} />
    </ReducedMotionProvider>,
  );
  await settle();
  return view;
}

async function pressBack(): Promise<void> {
  const listener = listeners.at(-1);
  if (listener === undefined) throw new Error("no Back listener was registered");
  await act(async () => {
    listener();
  });
  await settle();
}

/** The views the last call on the rail's guide named; `undefined` when it was never pointed. */
function railGuideViews(): unknown[] | undefined {
  return pointGuide.mock.calls.filter(([guide]) => testIDOf(guide) === "rail-guide").at(-1)?.[1];
}

/** The testIDs of the views the rail's guide was last pointed at. */
const railGuideTargets = (): unknown[] | undefined => railGuideViews()?.map(testIDOf);

type Registry = {
  register(key: RailKey, view: unknown): void;
  viewOf(key: RailKey): unknown;
};

/** What a rail's owner holds: each entry's view, as the rail last registered it. */
function registry(): Registry {
  const views = new Map<RailKey, unknown>();
  return {
    register: (key, view) => {
      if (view === null || view === undefined) views.delete(key);
      else views.set(key, view);
    },
    viewOf: (key) => views.get(key),
  };
}

function expectPointedAt(views: Registry, key: RailKey): void {
  const registered = views.viewOf(key);
  expect(registered).toBeDefined();
  const pointed = railGuideViews();
  expect(pointed).toHaveLength(1);
  expect(pointed?.[0]).toBe(registered);
}

const noop = () => undefined;
const allEntries = railEntries(fixtureLibraries, fixtureAccount);

function rail(views: Registry, current: RailKey, entries: RailEntry[] = allEntries): ReactElement {
  return (
    <ReducedMotionProvider value>
      <SideRail testID="rail" entries={entries} current={current} onSelect={noop} onOpenChange={noop} registerEntry={views.register} />
    </ReducedMotionProvider>
  );
}

describe("T3-43 item 1: under the shell, the rail's guide names the current screen's entry", () => {
  it.each([
    ["/", "rail-entry-home"],
    ["/search", "rail-entry-search"],
    ["/library/A", "rail-entry-library-A"],
    ["/settings", "rail-entry-settings"],
    ["/accounts", "rail-entry-account"],
  ])("T3-43 item 1: at %s the rail's guide names exactly one view, %s", async (path, entry) => {
    await renderShellAt(path);
    expect(railGuideTargets()).toEqual([entry]);
  });

  it("T3-43 item 1: after selecting the library A entry the rail's guide names that entry", async () => {
    await renderShellAt("/");
    await fireEvent.press(screen.getByTestId("rail-entry-library-A"));
    await settle();
    expect(railGuideTargets()).toEqual(["rail-entry-library-A"]);
  });

  it("T3-43 item 1: on an item opened from Home the rail's guide still names Home's entry", async () => {
    await renderShellAt("/");
    await fireEvent.press(screen.getByTestId("l-row-A-card-3"));
    await settle();
    expect(screen.getByTestId("screen-item")).toBeTruthy();
    expect(railGuideTargets()).toEqual(["rail-entry-home"]);
  });

  it("T3-43 item 1: when the rail comes back after the player, its new guide names Home's entry", async () => {
    await renderShellAt("/");
    await fireEvent.press(screen.getByTestId("home-primary"));
    await settle();
    expect(screen.queryByTestId("rail")).toBeNull();
    pointGuide.mockClear();
    await pressBack();
    expect(screen.getByTestId("rail")).toBeTruthy();
    expect(railGuideTargets()).toEqual(["rail-entry-home"]);
  });
});

describe("T3-43 item 1: the rail alone points its guide at the entry of its current prop", () => {
  it("T3-43 item 1: the guide names exactly the view registered for the current entry", async () => {
    const views = registry();
    await render(rail(views, "settings"));
    expectPointedAt(views, "settings");
    expect(railGuideTargets()).toEqual(["rail-entry-settings"]);
  });

  it("T3-43 item 1: the guide is pointed again when current changes", async () => {
    const views = registry();
    const view = await render(rail(views, "home"));
    expectPointedAt(views, "home");
    await view.rerender(rail(views, "search"));
    expectPointedAt(views, "search");
    expect(railGuideTargets()).toEqual(["rail-entry-search"]);
  });

  it("T3-43 item 1: the guide is pointed again when the entries change", async () => {
    const views = registry();
    const view = await render(rail(views, "home"));
    pointGuide.mockClear();
    await view.rerender(rail(views, "home", railEntries([...fixtureLibraries].reverse(), fixtureAccount)));
    expectPointedAt(views, "home");
  });

  it("T3-43 item 1: a current library that arrives with later entries is named once it is there", async () => {
    const views = registry();
    const view = await render(rail(views, "library:A", railEntries([], fixtureAccount)));
    await view.rerender(rail(views, "library:A"));
    expectPointedAt(views, "library:A");
    expect(railGuideTargets()).toEqual(["rail-entry-library-A"]);
  });

  it("T3-43 item 1: when the current entry's view registers again, the guide names the new view", async () => {
    const views = registry();
    await render(rail(views, "home"));
    const before = views.viewOf("home");
    await act(async () => {
      remountFrame("rail-entry-home");
    });
    expect(views.viewOf("home")).not.toBe(before);
    expectPointedAt(views, "home");
  });
});
