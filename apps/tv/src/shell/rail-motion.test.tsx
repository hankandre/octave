// The rail's open animation: with motion on it animates the width over durQuick; the final widths are the two tokens.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { ReducedMotionProvider } from "../design/motion";
import { px } from "../design/scale";
import { sizes } from "../design/tokens";
import { railEntries } from "./rail-entries";
import { SideRail } from "./side-rail";

jest.mock("./focus-bridge", () => require("./test-support/focus-bridge-double"));

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
});
afterEach(() => {
  jest.useRealTimers();
});

const widthStyle = () => (StyleSheet.flatten(screen.getByTestId("rail").props.style) as { width: number }).width;

describe("SideRail motion", () => {
  it("with motion on, the width is animated and ends at railOpenW", async () => {
    await render(
      <ReducedMotionProvider value={false}>
        <SideRail testID="rail" entries={railEntries([])} current="home" onSelect={() => undefined} onOpenChange={() => undefined} registerEntry={() => undefined} />
      </ReducedMotionProvider>,
    );
    expect(widthStyle()).toBe(px(sizes.railCollapsedW));
    await fireEvent(screen.getByTestId("rail-entry-home"), "focus", { nativeEvent: {} });
    await act(async () => {
      jest.advanceTimersByTime(40);
    });
    expect(widthStyle()).toBeGreaterThan(px(sizes.railCollapsedW));
    expect(widthStyle()).toBeLessThan(px(sizes.railOpenW));
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(widthStyle()).toBe(px(sizes.railOpenW));
  });
});
