// T8-04 D4: the screen reads a remote key only when it comes up. react-native-tvos also sends a held key's `long…` name
// on a key down, which the frozen `pressRemoteKey` never does, so these cases send key downs themselves.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, screen } from "@testing-library/react-native";
import { DeviceEventEmitter } from "react-native";
import { focusView, resetFocusBridge } from "../shell/test-support/focus-bridge-double";
import { focusRequests, focusTracker } from "./test-support/focus-follow";
import { advance, renderAfterFirstFrame, type PlayerRig } from "./test-support/player-rig";
import { pressRemoteKey } from "./test-support/remote";

jest.mock("../shell/focus-bridge", () => require("../shell/test-support/focus-bridge-double"));
jest.mock("../../node_modules/react-native/src/private/specs_DEPRECATED/modules/NativeTVNavigationEventEmitter", () =>
  require("./test-support/tv-emitter-double"),
);

// Android's KeyEvent.ACTION_DOWN.
const KEY_DOWN = 0;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
  resetFocusBridge();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function keyDown(name: string): Promise<void> {
  await act(async () => {
    DeviceEventEmitter.emit("onHWKeyEvent", { eventType: name, eventKeyAction: KEY_DOWN });
  });
}

const chromeDrawn = (): boolean => screen.queryByTestId("player-scrubber") !== null;

async function wakeOnScrubber(): Promise<PlayerRig> {
  const rig = await renderAfterFirstFrame();
  await pressRemoteKey("up");
  await focusTracker().follow();
  return rig;
}

describe("T8-04 D4: only a key coming up is read", () => {
  it("a held arrow's key down shows nothing, and its key up shows the controls once with focus on the scrubber", async () => {
    const rig = await renderAfterFirstFrame();
    focusView.mockClear();

    await keyDown("longRight");
    expect(chromeDrawn()).toBe(false);
    expect(focusRequests()).toEqual([]);

    await pressRemoteKey("longRight");
    expect(chromeDrawn()).toBe(true);
    expect(focusRequests()).toEqual(["Seek"]);
    expect(rig.viewing.seekBy).not.toHaveBeenCalled();
  });

  it("with the scrubber focused, a key down neither seeks nor pauses", async () => {
    const rig = await wakeOnScrubber();

    await keyDown("right");
    await keyDown("longRight");
    await keyDown("playPause");

    expect(rig.viewing.seekBy).not.toHaveBeenCalled();
    expect(rig.viewing.togglePaused).not.toHaveBeenCalled();
  });

  it("a key down does not start the idle time again", async () => {
    await wakeOnScrubber();
    await advance(2000);

    await keyDown("longRight");

    await advance(999);
    expect(chromeDrawn()).toBe(true);
    await advance(1);
    expect(chromeDrawn()).toBe(false);
  });
});

describe("T8-04 D5: the control row's remembered control", () => {
  it("is still where the scrubber's Down goes after the controls hid and showed again", async () => {
    await renderAfterFirstFrame();
    const tracker = focusTracker();
    await pressRemoteKey("right");
    await tracker.follow();
    await tracker.moveTo("Forward 10 seconds");
    await advance(3000);
    expect(chromeDrawn()).toBe(false);

    await pressRemoteKey("right");

    const forward = screen.getByLabelText("Forward 10 seconds").props.nextFocusDown;
    expect(forward).toEqual(expect.any(Number));
    expect(screen.getByLabelText("Seek").props.nextFocusDown).toBe(forward);
  });
});
