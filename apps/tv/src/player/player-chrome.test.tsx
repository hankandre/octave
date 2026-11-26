// T8-04 items 1 to 5 on the player screen (spec D4 to D7), over a fake viewing. Keys arrive as the library's own
// `onHWKeyEvent` device event; one select is sent once, on both of its paths, by `pressRemoteSelect`. Jest has no focus
// engine: the screen's focus requests are read from the bridge's double, and the tracker delivers the focus events.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { screen, within } from "@testing-library/react-native";
import { textOf } from "../home/test-support/home-doubles";
import { focusView, resetFocusBridge, tagOf } from "../shell/test-support/focus-bridge-double";
import { focusRequests, focusTracker, lastFocusRequest } from "./test-support/focus-follow";
import { EPISODE_TITLE, FILM_TITLE, advance, renderAfterFirstFrame, type PlayerRig } from "./test-support/player-rig";
import { pressRemoteKey, pressRemoteSelect } from "./test-support/remote";

jest.mock("../shell/focus-bridge", () => require("../shell/test-support/focus-bridge-double"));
jest.mock("../../node_modules/react-native/src/private/specs_DEPRECATED/modules/NativeTVNavigationEventEmitter", () =>
  require("./test-support/tv-emitter-double"),
);

const HOLDER = "Player controls";
const SCRUBBER = "Seek";
const ZONES = ["player-top-bar", "player-scrubber", "player-controls"];
const DIRECTIONS = ["nextFocusUp", "nextFocusDown", "nextFocusLeft", "nextFocusRight"] as const;
const ARROWS = ["up", "down", "left", "right"];

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
  resetFocusBridge();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const byLabel = (label: string) => screen.getByLabelText(label);
const zonesDrawn = (): string[] => ZONES.filter((zone) => screen.queryByTestId(zone) !== null);

function expectChromeShown(): void {
  expect(zonesDrawn()).toEqual(ZONES);
}

function expectPictureAlone(): void {
  expect(zonesDrawn()).toEqual([]);
  expect(screen.queryByTestId("player-back")).toBeNull();
  expect(screen.queryByTestId("player-title")).toBeNull();
  expect(screen.queryByLabelText(SCRUBBER)).toBeNull();
  expect(screen.queryByLabelText("Pause")).toBeNull();
  expect(screen.queryByLabelText("Back")).toBeNull();
}

function transportCalls(rig: PlayerRig): number[] {
  const { seekBy, togglePaused, setPaused, leave } = rig.viewing;
  return [seekBy, togglePaused, setPaused, leave].map((call) => call.mock.calls.length);
}

/** An arrow from the picture, then the focus landing where the screen asked. */
async function wakeOnScrubber(): Promise<ReturnType<typeof focusTracker>> {
  const tracker = focusTracker();
  await pressRemoteKey("right");
  expectChromeShown();
  await tracker.follow();
  return tracker;
}

function neighboursOf(label: string) {
  const props = byLabel(label).props;
  return { up: props.nextFocusUp, down: props.nextFocusDown, left: props.nextFocusLeft, right: props.nextFocusRight };
}

/** The labels of the control row's three buttons, in order. */
function controlRow(): [string, string, string] {
  const labels = within(screen.getByTestId("player-controls"))
    .getAllByRole("button")
    .map((button) => String(button.props.accessibilityLabel));
  expect(labels).toHaveLength(3);
  const [back = "", play = "", forward = ""] = labels;
  return [back, play, forward];
}

describe("T8-04 item 1: only the picture until a key is pressed", () => {
  it("T8-04 item 1: after the first frame only the picture and an invisible focus holder are drawn, however long it plays", async () => {
    const rig = await renderAfterFirstFrame();

    await advance(10_000);

    expect(screen.getByTestId("player-view")).toBeTruthy();
    expectPictureAlone();
    expect(byLabel(HOLDER).props.focusable).toBe(true);
    expect(transportCalls(rig)).toEqual([0, 0, 0, 0]);
  });

  it.each(ARROWS)("T8-04 item 1: one %s key shows the controls, asks focus for the scrubber alone and does not seek", async (arrow) => {
    const rig = await renderAfterFirstFrame();
    expectPictureAlone();
    focusView.mockClear();

    await pressRemoteKey(arrow);

    expectChromeShown();
    expect(focusRequests()).toEqual([SCRUBBER]);
    expect(transportCalls(rig)).toEqual([0, 0, 0, 0]);
  });

  it("T8-04 item 1: the focus holder names itself in all four directions, is focusable only while the controls are hidden, and takes focus back when they hide", async () => {
    await renderAfterFirstFrame();
    const tags = DIRECTIONS.map((direction) => byLabel(HOLDER).props[direction]);

    await wakeOnScrubber();
    expect(byLabel(HOLDER).props.focusable).toBe(false);
    focusView.mockClear();
    await advance(3000);

    expectPictureAlone();
    expect(byLabel(HOLDER).props.focusable).toBe(true);
    expect(focusRequests()).toEqual([HOLDER]);
    const own = tagOf(focusView.mock.calls.at(-1)?.[0]);
    expect(own).toEqual(expect.any(Number));
    expect(tags).toEqual([own, own, own, own]);
  });
});

describe("T8-04 item 2: Left and Right on the scrubber, and select from the picture", () => {
  it("T8-04 item 2: with the scrubber focused, each Right asks for 10 s forward once and each Left for 10 s back once", async () => {
    const rig = await renderAfterFirstFrame();
    await wakeOnScrubber();

    await pressRemoteKey("right");
    expect(rig.viewing.seekBy.mock.calls).toEqual([[10]]);
    await pressRemoteKey("left");
    expect(rig.viewing.seekBy.mock.calls).toEqual([[10], [-10]]);
  });

  it("T8-04 item 2: with focus moved on to a control of the control row, Left and Right seek nothing", async () => {
    const rig = await renderAfterFirstFrame();
    const tracker = await wakeOnScrubber();
    await tracker.moveTo("Pause");

    await pressRemoteKey("left");
    await pressRemoteKey("right");

    expect(rig.viewing.seekBy).not.toHaveBeenCalled();
    expectChromeShown();
  });

  it("T8-04 item 2: a held Left or Right on the scrubber seeks nothing", async () => {
    const rig = await renderAfterFirstFrame();
    await wakeOnScrubber();

    await pressRemoteKey("longLeft");
    await pressRemoteKey("longRight");

    expect(rig.viewing.seekBy).not.toHaveBeenCalled();
    expectChromeShown();
  });

  it("T8-04 item 2: one select from the picture shows the controls once with focus on Play or Pause, and pauses nothing", async () => {
    const rig = await renderAfterFirstFrame();
    expectPictureAlone();
    focusView.mockClear();

    await pressRemoteSelect(byLabel(HOLDER));
    await advance(0);

    expectChromeShown();
    expect(focusRequests()).toEqual(["Pause"]);
    expect(rig.viewing.setPaused).not.toHaveBeenCalled();
    expect(rig.viewing.togglePaused).not.toHaveBeenCalled();
    expect(rig.viewing.seekBy).not.toHaveBeenCalled();
  });

  it("T8-04 item 2: the chrome's moves are stated: Back, the scrubber and the control row name their neighbours, and the row's ends trap", async () => {
    await renderAfterFirstFrame();
    const tracker = await wakeOnScrubber();
    const [backTen, playPause, forwardTen] = controlRow();
    expect(playPause).toBe("Pause");

    const back = neighboursOf("Back");
    const scrubber = neighboursOf(SCRUBBER);
    const rewind = neighboursOf(backTen);
    const play = neighboursOf(playPause);
    const forward = neighboursOf(forwardTen);
    // Each element's own tag is the one it names where focus must not move.
    const own = { back: back.up, scrubber: scrubber.left, rewind: rewind.down, play: play.down, forward: forward.down };

    expect(new Set(Object.values(own)).size).toBe(5);
    for (const tag of Object.values(own)) expect(tag).toEqual(expect.any(Number));
    expect(back).toEqual({ up: own.back, down: own.scrubber, left: own.back, right: own.back });
    expect(scrubber).toEqual({ up: own.back, down: own.play, left: own.scrubber, right: own.scrubber });
    expect(rewind).toEqual({ up: own.scrubber, down: own.rewind, left: own.rewind, right: own.play });
    expect(play).toEqual({ up: own.scrubber, down: own.play, left: own.rewind, right: own.forward });
    expect(forward).toEqual({ up: own.scrubber, down: own.forward, left: own.play, right: own.forward });

    await tracker.moveTo(forwardTen);
    await tracker.moveTo(SCRUBBER);
    expect(neighboursOf(SCRUBBER).down).toBe(own.forward);
  });
});

/** Still shown one millisecond before `milliseconds` have passed, and gone when they have. */
async function expectHiddenAfterExactly(milliseconds: number): Promise<void> {
  await advance(milliseconds - 1);
  expectChromeShown();
  await advance(1);
  expectPictureAlone();
}

describe("T8-04 item 3: the controls hide 3 s after the last key while playing", () => {
  it("T8-04 item 3: while playing, the controls are shown at 2,999 ms after the last key and gone at 3,000 ms", async () => {
    await renderAfterFirstFrame();
    await wakeOnScrubber();

    await expectHiddenAfterExactly(3000);
  });

  it("T8-04 item 3: a key at 2 s starts the 3 s again", async () => {
    await renderAfterFirstFrame();
    await wakeOnScrubber();
    await advance(2000);

    await pressRemoteKey("right");

    await expectHiddenAfterExactly(3000);
  });

  it("T8-04 item 3: a held key starts the 3 s again too", async () => {
    await renderAfterFirstFrame();
    await wakeOnScrubber();
    await advance(2000);

    await pressRemoteKey("longRight");

    await expectHiddenAfterExactly(3000);
  });

  it("T8-04 item 3: they hide with a control focused too", async () => {
    await renderAfterFirstFrame();
    const tracker = await wakeOnScrubber();
    await tracker.moveTo("Pause");
    await pressRemoteKey("down");

    await expectHiddenAfterExactly(3000);
  });

  it("T8-04 item 3: while paused they stay, and 3 s after playback resumes they are gone", async () => {
    const rig = await renderAfterFirstFrame();
    await wakeOnScrubber();
    await rig.viewing.snapshot({ paused: true });

    await advance(60_000);
    expectChromeShown();

    await rig.viewing.snapshot({ paused: false });
    await expectHiddenAfterExactly(3000);
  });
});

/** Whether the element, or one it sits in, is a heading. */
function underHeading(testID: string): boolean {
  let element: ReturnType<typeof screen.getByTestId> | null = screen.getByTestId(testID);
  while (element !== null && element.props.accessibilityRole !== "header") element = element.parent;
  return element !== null;
}

describe("T8-04 item 4: the top bar", () => {
  it("T8-04 item 4: an episode shows Back, the series name and S1 · E2 with the episode title, as the screen's one heading", async () => {
    await renderAfterFirstFrame();
    await wakeOnScrubber();

    expect(textOf("player-title-series")).toBe("Harbor Lights");
    expect(textOf("player-title")).toBe(`S1 · E2 ${EPISODE_TITLE.name}`);
    const topBar = within(screen.getByTestId("player-top-bar"));
    expect(topBar.getByTestId("player-back").props.accessibilityLabel).toBe("Back");
    expect(topBar.getByTestId("player-title-series")).toBeTruthy();
    expect(topBar.getByTestId("player-title")).toBeTruthy();
    const headings = screen.container.queryAll((instance) => instance.props.accessibilityRole === "header");
    expect(headings).toHaveLength(1);
    expect(underHeading("player-title")).toBe(true);
  });

  it("T8-04 item 4: a film shows Back and its title, with no series line", async () => {
    const rig = await renderAfterFirstFrame();
    await rig.viewing.publish({ title: FILM_TITLE });
    await wakeOnScrubber();

    expect(textOf("player-title")).toBe("Salt Road");
    expect(screen.queryByTestId("player-title-series")).toBeNull();
    expect(within(screen.getByTestId("player-top-bar")).getByTestId("player-back")).toBeTruthy();
  });
});

describe("T8-04 item 5: pause and resume", () => {
  it("T8-04 item 5: the play-pause key from the picture toggles once per key, and pausing shows the controls with focus on Play or Pause", async () => {
    const rig = await renderAfterFirstFrame();
    focusView.mockClear();

    await pressRemoteKey("playPause");
    await advance(0);
    expect(rig.viewing.togglePaused).toHaveBeenCalledTimes(1);
    expectChromeShown();
    expect(lastFocusRequest()).toBe("Play");
    await advance(60_000);
    expectChromeShown();

    await pressRemoteKey("playPause");
    expect(rig.viewing.togglePaused).toHaveBeenCalledTimes(2);
    expect(rig.viewing.state().session.snapshot?.paused).toBe(false);
    expect(rig.viewing.seekBy).not.toHaveBeenCalled();
  });

  it("T8-04 item 5: the play-pause key with the controls shown toggles once per key and leaves focus where it is", async () => {
    const rig = await renderAfterFirstFrame();
    await wakeOnScrubber();
    focusView.mockClear();

    await pressRemoteKey("playPause");
    await advance(0);
    expect(rig.viewing.togglePaused).toHaveBeenCalledTimes(1);
    await pressRemoteKey("playPause");
    await advance(0);
    expect(rig.viewing.togglePaused).toHaveBeenCalledTimes(2);
    expect(focusRequests()).toEqual([]);
  });

  it("T8-04 item 5: the pause key pauses and the play key resumes", async () => {
    const rig = await renderAfterFirstFrame();

    await pressRemoteKey("pause");
    await advance(0);
    expect(rig.viewing.setPaused.mock.calls).toEqual([[true]]);
    expectChromeShown();
    await pressRemoteKey("play");
    expect(rig.viewing.setPaused.mock.calls).toEqual([[true], [false]]);
    expect(rig.viewing.togglePaused).not.toHaveBeenCalled();
  });

  it("T8-04 item 5: one select on Play or Pause toggles exactly once, and a second press toggles back", async () => {
    const rig = await renderAfterFirstFrame();
    const tracker = await wakeOnScrubber();
    await tracker.moveTo("Pause");

    await pressRemoteSelect(byLabel("Pause"));
    expect(rig.viewing.togglePaused).toHaveBeenCalledTimes(1);
    expect(rig.viewing.state().session.snapshot?.paused).toBe(true);

    await pressRemoteSelect(byLabel("Play"));
    expect(rig.viewing.togglePaused).toHaveBeenCalledTimes(2);
    expect(rig.viewing.state().session.snapshot?.paused).toBe(false);
    expect(rig.viewing.setPaused).not.toHaveBeenCalled();
  });

  it("T8-04 item 5: one select on the scrubber toggles exactly once, and a second press toggles back", async () => {
    const rig = await renderAfterFirstFrame();
    await wakeOnScrubber();

    await pressRemoteSelect(byLabel(SCRUBBER));
    expect(rig.viewing.togglePaused).toHaveBeenCalledTimes(1);
    await pressRemoteSelect(byLabel(SCRUBBER));
    expect(rig.viewing.togglePaused).toHaveBeenCalledTimes(2);
    expect(rig.viewing.state().session.snapshot?.paused).toBe(false);
    expect(rig.viewing.seekBy).not.toHaveBeenCalled();
    expect(rig.viewing.setPaused).not.toHaveBeenCalled();
  });
});
