// T8-27 items 1 and 2 on the player screen: select pauses and Left and Right step 10 s straight from the picture. Keys
// arrive as the library's own `onHWKeyEvent` device event; one select is sent once, on both of its paths, by
// `pressRemoteSelect`. Jest has no focus engine: the screen's focus requests are read from the bridge's double, and the
// tracker delivers the focus events.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { screen } from "@testing-library/react-native";
import { focusView, resetFocusBridge } from "../shell/test-support/focus-bridge-double";
import { focusRequests, focusTracker } from "./test-support/focus-follow";
import { advance, renderAfterFirstFrame, type PlayerRig } from "./test-support/player-rig";
import { pressRemoteKey, pressRemoteSelect } from "./test-support/remote";

jest.mock("../shell/focus-bridge", () => require("../shell/test-support/focus-bridge-double"));
jest.mock("../../node_modules/react-native/src/private/specs_DEPRECATED/modules/NativeTVNavigationEventEmitter", () =>
  require("./test-support/tv-emitter-double"),
);

const HOLDER = "Player controls";
const ZONES = ["player-top-bar", "player-scrubber", "player-controls"];

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

/** The player with only the picture showing, and no focus request counted yet. */
async function renderPicture(): Promise<PlayerRig> {
  const rig = await renderAfterFirstFrame();
  expect(zonesDrawn()).toEqual([]);
  focusView.mockClear();
  return rig;
}

describe("T8-27 item 1: select from the picture pauses, and select again resumes", () => {
  it("T8-27 item 1: one select pauses once and shows the controls with focus on Play or Pause, and one more resumes", async () => {
    const rig = await renderPicture();

    await pressRemoteSelect(byLabel(HOLDER));
    await advance(0);

    expect(rig.viewing.togglePaused).toHaveBeenCalledTimes(1);
    expect(rig.viewing.state().session.snapshot?.paused).toBe(true);
    expect(zonesDrawn()).toEqual(ZONES);
    expect(focusRequests()).toEqual(["Play"]);

    await focusTracker().follow();
    await pressRemoteSelect(byLabel("Play"));

    expect(rig.viewing.togglePaused).toHaveBeenCalledTimes(2);
    expect(rig.viewing.state().session.snapshot?.paused).toBe(false);
    expect(rig.viewing.setPaused).not.toHaveBeenCalled();
    expect(rig.viewing.seekBy).not.toHaveBeenCalled();
  });
});

describe("T8-27 item 2: the arrows from the picture", () => {
  it.each([
    ["left", [[-10]]],
    ["right", [[10]]],
    ["up", []],
    ["down", []],
  ])("T8-27 item 2: one %s shows the controls with focus on the scrubber and asks for the seeks %j", async (arrow, seeks) => {
    const rig = await renderPicture();

    await pressRemoteKey(arrow);

    expect(rig.viewing.seekBy.mock.calls).toEqual(seeks);
    expect(zonesDrawn()).toEqual(ZONES);
    expect(focusRequests()).toEqual(["Seek"]);
    expect(rig.viewing.togglePaused).not.toHaveBeenCalled();
    expect(rig.viewing.setPaused).not.toHaveBeenCalled();
    expect(rig.viewing.leave).not.toHaveBeenCalled();
  });

  it("T8-27 item 2: a second Left before focus lands on the scrubber moves another 10 s", async () => {
    const rig = await renderPicture();

    await pressRemoteKey("left");
    await pressRemoteKey("left");

    expect(rig.viewing.seekBy.mock.calls).toEqual([[-10], [-10]]);
  });

  it.each(["longLeft", "longRight"])("T8-27 item 2: a held arrow from the picture (%s) seeks nothing", async (key) => {
    const rig = await renderPicture();

    await pressRemoteKey(key);

    expect(rig.viewing.seekBy).not.toHaveBeenCalled();
    expect(zonesDrawn()).toEqual(ZONES);
    expect(focusRequests()).toEqual(["Seek"]);
  });
});
