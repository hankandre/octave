// T3-06: the implementer's own behaviour tests for the controls (not frozen).
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { glyphs, iconOf } from "../icon";
import { colors, motion } from "../tokens";
import { Switch } from "./switch";
import { Skeleton } from "./skeleton";
import { Toast } from "./toast";
import { IconButton } from "./icon-button";
import { renderWith } from "../test-support/harness";

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
});
afterEach(() => {
  jest.useRealTimers();
});


describe("Toast", () => {
  it("an info toast calls onDismiss after toastMs, and not before", async () => {
    const onDismiss = jest.fn();
    await renderWith(<Toast testID="toast" visible kind="info" message="Saved." onDismiss={onDismiss} />, false);
    await act(async () => {
      jest.advanceTimersByTime(motion.toastMs - 1);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("an error toast never dismisses itself", async () => {
    const onDismiss = jest.fn();
    await renderWith(<Toast testID="toast" visible kind="error" message="Could not save that." onDismiss={onDismiss} />, false);
    await act(async () => {
      jest.advanceTimersByTime(motion.toastMs * 3);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe("Skeleton", () => {
  it("shows its block only after skeletonDelayMs", async () => {
    await renderWith(<Skeleton testID="sk" />, false);
    expect(screen.queryByTestId("sk")).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(motion.skeletonDelayMs);
    });
    expect(screen.getByTestId("sk")).toBeTruthy();
  });
});

describe("Switch", () => {
  it("is on text1 with an onLight thumb when on, and surface3 with a text2 thumb when off", async () => {
    const { rerender } = await renderWith(<Switch testID="sw" accessibilityLabel="Autoplay" value={false} onValueChange={jest.fn()} />, false);
    const backgrounds = () =>
      screen.container
        .queryAll((instance) => typeof instance.props.style === "object" && instance.props.style !== null)
        .map((instance) => StyleSheet.flatten(instance.props.style)?.backgroundColor)
        .filter(Boolean);
    expect(backgrounds()).toEqual(expect.arrayContaining([colors.surface3, colors.text2]));
    await rerender(<Switch testID="sw" accessibilityLabel="Autoplay" value onValueChange={jest.fn()} />);
    expect(backgrounds()).toEqual(expect.arrayContaining([colors.text1, colors.onLight]));
  });
});

describe("IconButton", () => {
  it("gives its icon a size and the text1 colour", async () => {
    await renderWith(<IconButton testID="ib" icon={iconOf("search")} accessibilityLabel="Search" onPress={jest.fn()} />, false);
    const style = StyleSheet.flatten(screen.getByText(String.fromCodePoint(glyphs.search)).props.style);
    expect(style.fontSize).toBeGreaterThan(0);
    expect(style.color).toBe(colors.text1);
    await fireEvent(screen.getByTestId("ib"), "focus", { nativeEvent: {} });
  });
});
