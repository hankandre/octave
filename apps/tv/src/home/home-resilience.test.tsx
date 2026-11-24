// A failed Home load leaves a plain surface and no unhandled rejection; new services replace the old rows; a failed backdrop
// layer takes the older layers with it. (T5-03 review fixes; new file, the frozen tests are untouched.)
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, render, screen } from "@testing-library/react-native";
import { Animated } from "react-native";
import type { ReactElement } from "react";
import { View } from "react-native";
import type { ImageRef } from "@octave/core/src/domain/catalog";
import { ArtworkProvider } from "../design/rows/artwork";
import { FocusPlaceContext } from "../design/rows/focus-place-context";
import { ReducedMotionProvider } from "../design/motion";
import { ShellContext } from "../shell/shell-context";
import { HomeScreen, HomeServicesContext } from "./index";
import { cwEpisode, defaultLists, flush, focusOn, heroFilm, makeRig, movie, nextEpisode, renderHome, rowCard, type Rig } from "./test-support/home-doubles";

jest.mock("@shopify/flash-list", () => require("../design/rows/test-support/flash-list-double"));

describe("T5-03 review: a failed load", () => {
  it("leaves a plain surface and raises no unhandled rejection", async () => {
    const unhandled = jest.fn();
    process.on("unhandledRejection", unhandled);
    try {
      await renderHome(makeRig({}, { clock: { now: () => { throw new Error("clock"); } } }));
      await flush();
      await new Promise<void>((resolve) => setImmediate(() => resolve()));
      expect(unhandled).not.toHaveBeenCalled();
      expect(screen.queryByTestId("home-rows-list")).toBeNull();
      expect(screen.queryByTestId("home-hero-title")).toBeNull();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});

const failing: Record<string, () => void> = {};
function RecordingArtwork(props: { image: ImageRef; width: number; height: number; onFailed: () => void; testID?: string }): ReactElement {
  failing[String(props.testID)] = props.onFailed;
  return <View testID={props.testID} {...({ image: props.image } as object)} />;
}

function tree(rig: Rig, reduced: boolean): ReactElement {
  return (
    <ReducedMotionProvider value={reduced}>
      <ShellContext.Provider value={{ open: rig.open as never, route: { kind: "home" } }}>
        <FocusPlaceContext.Provider value={rig.reporter}>
          <ArtworkProvider component={RecordingArtwork}>
            <HomeServicesContext.Provider value={rig.services}>
              <HomeScreen route={{ kind: "home" }} />
            </HomeServicesContext.Provider>
          </ArtworkProvider>
        </FocusPlaceContext.Provider>
      </ShellContext.Provider>
    </ReducedMotionProvider>
  );
}

describe("T5-03 review: new services", () => {
  it("replace the rows and the hero of the old ones", async () => {
    const first = makeRig();
    const view = await render(tree(first, false));
    await flush();
    expect(screen.getByTestId("home-hero-title")).toBeTruthy();
    const lists = defaultLists();
    const other = movie("other-hero", { title: "Other Hero", resumePositionTicks: 5, progress: 0.1, remainingTicks: 5, lastPlayedAt: heroFilm.lastPlayedAt as string });
    const second = makeRig({ resume: [other, ...lists.resume.slice(1)] });
    await view.rerender(tree(second, false));
    await flush();
    expect(String(screen.getByTestId("home-hero-title").props.children)).toContain("Other Hero");
  });
});

describe("T5-03 review: a failed backdrop layer", () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
    jest.spyOn(Animated, "timing").mockImplementation((() => ({ start: () => undefined, stop: () => undefined, reset: () => undefined })) as never);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("never leaves the previous title's picture behind", async () => {
    await render(tree(makeRig(), false));
    await flush();
    await focusOn(rowCard("continue-watching", 0));
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await focusOn(rowCard("continue-watching", 2));
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    const shown = () => screen.queryAllByTestId(/^home-backdrop-artwork/).map((element) => element.props.image as ImageRef);
    expect(shown()).toEqual([heroFilm.backdrop, cwEpisode.backdrop, nextEpisode.backdrop]);
    const newest = screen.queryAllByTestId(/^home-backdrop-artwork/).at(-1);
    await act(async () => {
      failing[String(newest?.props.testID)]?.();
    });
    expect(shown()).toEqual([]);
  });
});
