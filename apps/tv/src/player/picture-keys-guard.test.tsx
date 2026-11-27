// T8-27 item 3 (met on main, guarded here) and the ruling on check issue 4: before the first frame and on a failure, the
// picture's new keys do nothing. Select on the holder's place, every arrow and the play-pause key call no transport
// method and draw no zone.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { screen } from "@testing-library/react-native";
import { resetFocusBridge } from "../shell/test-support/focus-bridge-double";
import { pressSelect } from "../design/test-support/select-key";
import { advance, loadingState, renderAfterFirstFrame, renderPlayer, type PlayerRig } from "./test-support/player-rig";
import { pressRemoteKey } from "./test-support/remote";

jest.mock("../shell/focus-bridge", () => require("../shell/test-support/focus-bridge-double"));
jest.mock("../../node_modules/react-native/src/private/specs_DEPRECATED/modules/NativeTVNavigationEventEmitter", () =>
  require("./test-support/tv-emitter-double"),
);

const ZONES = ["player-top-bar", "player-scrubber", "player-controls"];
const KEYS = ["up", "down", "left", "right", "longLeft", "longRight", "playPause"];

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
  resetFocusBridge();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const zonesDrawn = (): string[] => ZONES.filter((zone) => screen.queryByTestId(zone) !== null);

async function pressEverything(): Promise<void> {
  for (const key of KEYS) await pressRemoteKey(key);
  await pressRemoteKey("select");
  await pressSelect(screen.getByLabelText("Player controls"));
  await advance(0);
}

function expectNothingDone(rig: PlayerRig): void {
  expect(rig.viewing.togglePaused).not.toHaveBeenCalled();
  expect(rig.viewing.setPaused).not.toHaveBeenCalled();
  expect(rig.viewing.seekBy).not.toHaveBeenCalled();
  expect(zonesDrawn()).toEqual([]);
}

describe("T8-27: the picture's keys outside the picture", () => {
  it("before the first frame, no key moves the transport or draws a zone", async () => {
    const rig = await renderPlayer(loadingState());

    await pressEverything();

    expectNothingDone(rig);
  });

  it("on a failure, select on the holder's place and the keys move nothing", async () => {
    const rig = await renderAfterFirstFrame();
    await rig.viewing.publish({ phase: "failed", session: { firstFrameReady: true, failure: "server-unreachable" } });

    await pressEverything();

    expectNothingDone(rig);
  });
});
