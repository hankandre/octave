// T3-06 item 3: each control has a focused, pressed and disabled state (DESIGN.md §7.16 to §7.19, spec "State matrix").
// Button, IconButton, TextField and Switch take focus themselves. Dialog, Toast, Notice and EmptyState are containers
// whose actions are Buttons, so their states are the actions' states. Skeleton and an info Toast take no focus.
// Reduced motion is off through the ReducedMotionProvider override. The scale value reached is not frozen.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { motion } from "../tokens";
import { Button } from "./button";
import { Skeleton } from "./skeleton";
import { Toast } from "./toast";
import { Notice } from "./notice";
import { EmptyState } from "./empty-state";
import { FOCUSABLE_CASES } from "../test-support/cases";
import { focusableElements, hasTransform, renderWith } from "../test-support/harness";

const event = { nativeEvent: {} };

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
});
afterEach(() => {
  jest.useRealTimers();
});

for (const control of FOCUSABLE_CASES) {
  describe(`T3-06 item 3: ${control.name}`, () => {
    it("shows its focus ring after focus and removes it on blur", async () => {
      await renderWith(control.make(jest.fn(), false), false);
      const element = screen.getByTestId(control.id);
      expect(screen.queryByTestId(`${control.id}-focus-ring`)).toBeNull();
      await fireEvent(element, "focus", event);
      expect(screen.getByTestId(`${control.id}-focus-ring`)).toBeTruthy();
      await fireEvent(element, "blur", event);
      expect(screen.queryByTestId(`${control.id}-focus-ring`)).toBeNull();
    });

    it("has no transform at rest and a scale transform right after pressIn, with its handler not yet called", async () => {
      const handler = jest.fn();
      await renderWith(control.make(handler, false), false);
      const element = screen.getByTestId(control.id);
      expect(hasTransform(screen.getByTestId(`${control.id}-scale`))).toBe(false);
      await fireEvent(element, "pressIn", event);
      expect(hasTransform(screen.getByTestId(`${control.id}-scale`))).toBe(true);
      expect(handler).not.toHaveBeenCalled();
    });

    if (control.canDisable) {
      it("when disabled takes no focus, reports it, and calls nothing on focus then press", async () => {
        const handler = jest.fn();
        await renderWith(control.make(handler, true), false);
        const element = screen.getByTestId(control.id);
        expect(element.props.focusable).toBe(false);
        expect(element.props.accessibilityState?.disabled).toBe(true);
        await fireEvent(element, "focus", event);
        await fireEvent(element, "press", event);
        expect(handler).not.toHaveBeenCalled();
        expect(screen.queryByTestId(`${control.id}-focus-ring`)).toBeNull();
      });
    }
  });
}

describe("T3-06 item 3: Button variants", () => {
  it.each(["primary", "secondary", "quiet", "danger"] as const)("%s draws the focus ring", async (variant) => {
    await renderWith(<Button testID="btn" label="Go" variant={variant} onPress={jest.fn()} />, false);
    await fireEvent(screen.getByTestId("btn"), "focus", event);
    expect(screen.getByTestId("btn-focus-ring")).toBeTruthy();
  });
});

describe("T3-06 item 3: Toast (info)", () => {
  it("shows its message and takes no focus and no select", async () => {
    await renderWith(<Toast testID="toast" visible kind="info" message="Saved." onDismiss={jest.fn()} />, false);
    expect(screen.getByText("Saved.")).toBeTruthy();
    expect(focusableElements()).toHaveLength(0);
    expect(screen.queryByTestId("toast-dismiss")).toBeNull();
  });
});

describe("T3-06 item 3: Notice", () => {
  it("owns no focus state itself: only its actions are focusable", async () => {
    await renderWith(
      <Notice testID="notice" title="Cannot reach the server" message="Check that it is on." actions={[{ id: "retry", label: "Try again", onPress: jest.fn() }]} />,
      false,
    );
    expect(focusableElements().map((element) => element.props.testID)).toEqual(["notice-retry"]);
  });
});

describe("T3-06 item 3: EmptyState", () => {
  it("with no action has nothing focusable", async () => {
    await renderWith(<EmptyState testID="empty" title="Nothing here yet" message="Add a library on your server." />, false);
    expect(screen.getByText("Nothing here yet")).toBeTruthy();
    expect(focusableElements()).toHaveLength(0);
  });
});

describe("T3-06 item 3: Skeleton", () => {
  it("is a placeholder: shown after its delay, and exposes nothing focusable", async () => {
    await renderWith(<Skeleton testID="sk" />, false);
    await act(async () => {
      jest.advanceTimersByTime(motion.skeletonDelayMs * 4);
    });
    expect(screen.getByTestId("sk")).toBeTruthy();
    expect(focusableElements()).toHaveLength(0);
    expect(screen.queryByTestId("sk-focus-ring")).toBeNull();
  });
});
