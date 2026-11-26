// T8-04 D5, with motion on: the controls fade out where they stand. They stay mounted from the first render of the fade,
// out of focus, while the focus holder already takes it; a control dropped and mounted again would lose its focus and
// the neighbours that name it. Every commit is read, so a single render without them is seen.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen, within } from "@testing-library/react-native";
import { Profiler } from "react";
import { View } from "react-native";
import { ReducedMotionProvider } from "../design/motion";
import { motion } from "../design/tokens";
import { ShellContext } from "../shell/shell-context";
import { resetFocusBridge } from "../shell/test-support/focus-bridge-double";
import { PlayerScreen } from "./player-screen";
import { PlayerServicesContext } from "./player-services";
import { ITEM_ID, advance, fakeViewing, playingState } from "./test-support/player-rig";
import { pressRemoteKey } from "./test-support/remote";

jest.mock("../shell/focus-bridge", () => require("../shell/test-support/focus-bridge-double"));
jest.mock("../../node_modules/react-native/src/private/specs_DEPRECATED/modules/NativeTVNavigationEventEmitter", () =>
  require("./test-support/tv-emitter-double"),
);

const ZONES = ["player-top-bar", "player-scrubber", "player-controls"];

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
  resetFocusBridge();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/** What one committed render holds. */
function committed() {
  return {
    zones: ZONES.filter((zone) => screen.queryByTestId(zone) !== null).length,
    holderFocusable: screen.queryByLabelText("Player controls")?.props.focusable as unknown,
    controlsFocusable: [screen.queryByTestId("player-back"), screen.queryByLabelText("Seek"), screen.queryByLabelText("Pause")].map(
      (control) => control?.props.focusable as unknown,
    ),
  };
}

describe("T8-04 D5: the controls fade out without being dropped", () => {
  it("every commit of the fade keeps the three zones out of focus with the holder focusable, and they go after durBase", async () => {
    const commits: ReturnType<typeof committed>[] = [];
    let recording = false;
    const services = { viewing: fakeViewing(playingState()), PlayerView: View, serverName: "Fixture Server", log: () => undefined };
    await render(
      <ReducedMotionProvider value={false}>
        <ShellContext.Provider value={{ open: () => undefined, route: { kind: "play", id: ITEM_ID } }}>
          <PlayerServicesContext.Provider value={services}>
            <Profiler
              id="player"
              onRender={() => {
                if (recording) commits.push(committed());
              }}
            >
              <PlayerScreen />
            </Profiler>
          </PlayerServicesContext.Provider>
        </ShellContext.Provider>
      </ReducedMotionProvider>,
    );
    await pressRemoteKey("right");
    await advance(motion.chromeIdleMs - 1);
    expect(within(screen.getByTestId("player-controls")).getAllByRole("button")).toHaveLength(3);

    recording = true;
    await advance(1);
    recording = false;

    const fading = { zones: ZONES.length, holderFocusable: true, controlsFocusable: [false, false, false] };
    expect(commits.length).toBeGreaterThan(0);
    for (const commit of commits) expect(commit).toEqual(fading);

    await advance(motion.durBase * 2);
    expect(committed().zones).toBe(0);
  });
});
