// T8-04 item 6 on the player screen (spec D8), over a fake viewing: the loading layer says only what is known, and
// "Buffering…" waits half a second.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { screen } from "@testing-library/react-native";
import { textOf } from "../home/test-support/home-doubles";
import { resetFocusBridge } from "../shell/test-support/focus-bridge-double";
import {
  BACKDROP,
  EPISODE_TITLE,
  advance,
  loadingState,
  playingState,
  renderAfterFirstFrame,
  renderPlayer,
} from "./test-support/player-rig";

jest.mock("../shell/focus-bridge", () => require("../shell/test-support/focus-bridge-double"));
jest.mock("../../node_modules/react-native/src/private/specs_DEPRECATED/modules/NativeTVNavigationEventEmitter", () =>
  require("./test-support/tv-emitter-double"),
);

const LOADING = "Loading…";
const OPENING = "Opening the original file…";
const BUFFERING = "Buffering…";

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
  resetFocusBridge();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const shows = (copy: string): boolean => screen.queryByText(copy) !== null;

/** How many artwork slots draw the item's backdrop. */
const backdrops = (): number =>
  screen.container.queryAll((instance) => (instance.props as { image?: unknown }).image === BACKDROP).length;

describe("T8-04 item 6: loading", () => {
  it("T8-04 item 6: loading says Loading… with no title, then shows the title over its backdrop, then Opening the original file… for a direct play, and goes at the first frame", async () => {
    const rig = await renderPlayer(loadingState());

    expect(shows(LOADING)).toBe(true);
    expect(shows(OPENING)).toBe(false);
    expect(screen.queryByTestId("player-title")).toBeNull();
    expect(backdrops()).toBe(0);
    expect(screen.getByLabelText("Back")).toBeTruthy();

    await rig.viewing.publish({ title: EPISODE_TITLE, backdrop: BACKDROP });
    expect(textOf("player-title-series")).toBe("Harbor Lights");
    expect(textOf("player-title")).toBe("S1 · E2 The Keeper's Log");
    expect(backdrops()).toBe(1);
    expect(shows(LOADING)).toBe(true);
    expect(shows(OPENING)).toBe(false);

    await rig.viewing.publish({ opening: "original" });
    expect(shows(OPENING)).toBe(true);
    expect(shows(LOADING)).toBe(false);

    await rig.viewing.publish(playingState());
    await advance(0);
    expect(shows(OPENING)).toBe(false);
    expect(shows(LOADING)).toBe(false);
    expect(backdrops()).toBe(0);
    expect(screen.queryByTestId("player-title")).toBeNull();
    expect(screen.queryByLabelText("Back")).toBeNull();
    expect(screen.getByTestId("player-view")).toBeTruthy();
  });
});

describe("T8-04 item 6: buffering after the first frame", () => {
  it("T8-04 item 6: Buffering… is not shown at 499 ms, is shown at 500 ms, and goes with the next snapshot that is not buffering", async () => {
    const rig = await renderAfterFirstFrame();
    await rig.viewing.snapshot({ buffering: true });

    expect(shows(BUFFERING)).toBe(false);
    await advance(499);
    expect(shows(BUFFERING)).toBe(false);
    await advance(1);
    expect(shows(BUFFERING)).toBe(true);

    await rig.viewing.snapshot({ buffering: false });
    expect(shows(BUFFERING)).toBe(false);
  });

  it("T8-04 item 6: another buffering snapshot on the way does not start the half second again", async () => {
    const rig = await renderAfterFirstFrame();
    await rig.viewing.snapshot({ buffering: true });
    await advance(300);
    await rig.viewing.snapshot({ buffering: true, positionSeconds: 101 });

    await advance(199);
    expect(shows(BUFFERING)).toBe(false);
    await advance(1);
    expect(shows(BUFFERING)).toBe(true);
  });

  it("T8-04 item 6: buffering for 300 ms never shows it, and a later buffering waits its own half second", async () => {
    const rig = await renderAfterFirstFrame();
    await rig.viewing.snapshot({ buffering: true });
    await advance(300);
    expect(shows(BUFFERING)).toBe(false);
    await rig.viewing.snapshot({ buffering: false });
    await advance(1000);
    expect(shows(BUFFERING)).toBe(false);

    await rig.viewing.snapshot({ buffering: true });
    await advance(499);
    expect(shows(BUFFERING)).toBe(false);
    await advance(1);
    expect(shows(BUFFERING)).toBe(true);
  });
});
