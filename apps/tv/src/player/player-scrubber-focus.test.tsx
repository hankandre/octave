// T8-27 item 4: how the scrubber shows focus (spec D2). The thumb is 24 canvas px and carries the two-tone ring, and the
// track still grows. Unfocused there is neither, as before.
//
// Testing contract: the testIDs are player-scrubber-track, player-scrubber-thumb and, inside the thumb,
// player-scrubber-thumb-focus-ring (the inner ring, as `FocusRing` names it). The dark edge is drawn beside it.
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import type { TestInstance } from "test-renderer";
import { px } from "../design/scale";
import { flat, ringColor, ringWidth } from "../design/test-support/harness";
import { colors, focus, radii, sizes } from "../design/tokens";
import { PlayerScrubber } from "./player-scrubber";
import { fakeViewing, playingState } from "./test-support/player-rig";

// The Shield's window: 960 dp wide at density 2, so one canvas px is 0.5 dp.
jest.mock("../design/scale", () => ({ canvasScale: () => 0.5, px: (canvasPx: number) => canvasPx * 0.5 }));
jest.mock("../shell/focus-bridge", () => require("../shell/test-support/focus-bridge-double"));

const THUMB_CANVAS_PX = 24;
const RING = "player-scrubber-thumb-focus-ring";
const event = { nativeEvent: {} };
const noop = () => undefined;

async function renderScrubber(): Promise<void> {
  await render(
    <PlayerScrubber viewing={fakeViewing(playingState())} focusable viewRef={noop} onPress={noop} onStep={noop} onFocus={noop} onBlur={noop} />,
  );
}

const trackHeight = (): unknown => flat(screen.getByTestId("player-scrubber-track")).height;

/** The colours of the overlays drawn beside the ring. */
function coloursBeside(ring: TestInstance): unknown[] {
  const siblings = ring.parent?.children.filter((child): child is TestInstance => typeof child !== "string") ?? [];
  return siblings.map((sibling) => flat(sibling).borderColor);
}

describe("T8-27 item 4: the focused scrubber", () => {
  it("T8-27 item 4: focused, the thumb is 24 px, carries the two-tone focus ring, and the track grows", async () => {
    await renderScrubber();

    await fireEvent(screen.getByLabelText("Seek"), "focus", event);

    const thumb = screen.getByTestId("player-scrubber-thumb");
    expect(flat(thumb).width).toBe(px(THUMB_CANVAS_PX));
    expect(flat(thumb).height).toBe(px(THUMB_CANVAS_PX));
    const ring = within(thumb).getByTestId(RING);
    expect(ringColor(flat(ring))).toBe(colors.focus);
    expect(ringWidth(flat(ring))).toBe(px(focus.focusRingWidth));
    expect(flat(ring).borderRadius).toBe(px(radii.radiusPill) + px(focus.focusOffset + focus.focusRingWidth));
    expect(coloursBeside(ring)).toContain(colors.focusEdge);
    expect(trackHeight()).toBe(px(sizes.scrubTrackHActive));
  });

  it("T8-27 item 4: unfocused, before focus and after it left, there is no thumb or ring and the track is thin", async () => {
    await renderScrubber();
    const expectUnfocused = (): void => {
      expect(screen.queryByTestId("player-scrubber-thumb")).toBeNull();
      expect(screen.queryByTestId(RING)).toBeNull();
      expect(trackHeight()).toBe(px(sizes.scrubTrackH));
    };
    expectUnfocused();

    await fireEvent(screen.getByLabelText("Seek"), "focus", event);
    expect(screen.getByTestId(RING)).toBeTruthy();
    await fireEvent(screen.getByLabelText("Seek"), "blur", event);

    expectUnfocused();
  });
});
