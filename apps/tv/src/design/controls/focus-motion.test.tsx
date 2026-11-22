// T3-06 item 4: a focused control shows the ring and the lift; with reduced motion on, nothing scales or fades.
// The value the scale reaches after durQuick (lift) is not frozen: it depends on native-driver Animated under fake
// timers. Only the presence or absence of a `scale` transform on the `-scale` element is asserted.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import { ReducedMotionProvider } from "../motion";
import { px } from "../scale";
import { colors, focus } from "../tokens";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { Toast } from "./toast";
import { FOCUSABLE_CASES } from "../test-support/cases";
import { flat, hasTransform, renderWith, ringColor, ringWidth, scaleOf } from "../test-support/harness";

const event = { nativeEvent: {} };

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/** Mocks AccessibilityInfo and returns a function that delivers a `reduceMotionChanged` event. */
function mockAccessibility(initial: boolean): (value: boolean) => Promise<void> {
  let listener: ((value: boolean) => void) | undefined;
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(initial);
  jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(((name: string, handler: (value: boolean) => void) => {
    if (name === "reduceMotionChanged") listener = handler;
    return { remove: () => undefined };
  }) as never);
  return async (value) => {
    await act(async () => {
      listener?.(value);
    });
  };
}

for (const control of FOCUSABLE_CASES) {
  describe(`T3-06 item 4: ${control.name}`, () => {
    it("with reduced motion off, a focus draws the ring in the focus colour and width and puts a scale transform on the -scale element", async () => {
      await renderWith(control.make(jest.fn(), false), false);
      await fireEvent(screen.getByTestId(control.id), "focus", event);
      const ring = flat(screen.getByTestId(`${control.id}-focus-ring`));
      expect(ringColor(ring)).toBe(colors.focus);
      expect(ringWidth(ring)).toBe(px(focus.focusRingWidth));
      expect(scaleOf(screen.getByTestId(`${control.id}-scale`))).not.toBeNull();
    });

    it("with reduced motion on (override), a focus draws the ring and sets no transform, before or after pressIn", async () => {
      await renderWith(control.make(jest.fn(), false), true);
      const element = screen.getByTestId(control.id);
      await fireEvent(element, "focus", event);
      expect(screen.getByTestId(`${control.id}-focus-ring`)).toBeTruthy();
      expect(hasTransform(screen.getByTestId(`${control.id}-scale`))).toBe(false);
      await fireEvent(element, "pressIn", event);
      expect(hasTransform(screen.getByTestId(`${control.id}-scale`))).toBe(false);
    });

    it("with the system's reduce-motion setting on (AccessibilityInfo), a focus draws the ring and sets no transform, before or after pressIn", async () => {
      mockAccessibility(true);
      await render(<ReducedMotionProvider>{control.make(jest.fn(), false)}</ReducedMotionProvider>);
      await act(async () => {});
      const element = screen.getByTestId(control.id);
      await fireEvent(element, "focus", event);
      expect(screen.getByTestId(`${control.id}-focus-ring`)).toBeTruthy();
      expect(hasTransform(screen.getByTestId(`${control.id}-scale`))).toBe(false);
      await fireEvent(element, "pressIn", event);
      expect(hasTransform(screen.getByTestId(`${control.id}-scale`))).toBe(false);
    });
  });
}

describe("T3-06 item 4: reduceMotionChanged", () => {
  it("switches the behaviour live", async () => {
    const deliver = mockAccessibility(false);
    await render(
      <ReducedMotionProvider>
        <Button testID="btn" label="Play" onPress={jest.fn()} />
      </ReducedMotionProvider>,
    );
    await act(async () => {});
    const element = screen.getByTestId("btn");

    await fireEvent(element, "focus", event);
    expect(scaleOf(screen.getByTestId("btn-scale"))).not.toBeNull();
    await fireEvent(element, "blur", event);

    await deliver(true);
    await fireEvent(element, "focus", event);
    expect(screen.getByTestId("btn-focus-ring")).toBeTruthy();
    expect(hasTransform(screen.getByTestId("btn-scale"))).toBe(false);
    await fireEvent(element, "blur", event);

    await deliver(false);
    await fireEvent(element, "focus", event);
    expect(scaleOf(screen.getByTestId("btn-scale"))).not.toBeNull();
  });
});

describe("T3-06 item 4: Dialog and Toast with reduced motion", () => {
  const opacityOf = (id: string) => flat(screen.getByTestId(id)).opacity ?? 1;

  it("a shown Dialog is at full opacity at once, with no timer advanced", async () => {
    await renderWith(<Dialog testID="dlg" visible title="Remove this server?" actions={[{ id: "ok", label: "Remove", onPress: jest.fn() }]} onDismiss={jest.fn()} />, true);
    expect(opacityOf("dlg-fade")).toBe(1);
  });

  it("a hidden Dialog is removed at once, with no timer advanced", async () => {
    const dialog = (visible: boolean) => <Dialog testID="dlg" visible={visible} title="Remove this server?" actions={[{ id: "ok", label: "Remove", onPress: jest.fn() }]} onDismiss={jest.fn()} />;
    const { rerender } = await renderWith(dialog(true), true);
    await rerender(
      <ReducedMotionProvider value>
        {dialog(false)}
      </ReducedMotionProvider>,
    );
    expect(screen.queryByTestId("dlg-fade")).toBeNull();
  });

  it("a shown Toast is at full opacity at once, with no timer advanced", async () => {
    await renderWith(<Toast testID="toast" visible kind="info" message="Saved." onDismiss={jest.fn()} />, true);
    expect(opacityOf("toast-fade")).toBe(1);
  });

  it("a hidden Toast is removed at once, with no timer advanced", async () => {
    const { rerender } = await renderWith(<Toast testID="toast" visible kind="info" message="Saved." onDismiss={jest.fn()} />, true);
    await rerender(
      <ReducedMotionProvider value>
        <Toast testID="toast" visible={false} kind="info" message="Saved." onDismiss={jest.fn()} />
      </ReducedMotionProvider>,
    );
    expect(screen.queryByTestId("toast-fade")).toBeNull();
  });

  it("a Toast is at full opacity at once when the system setting is on", async () => {
    mockAccessibility(true);
    await render(
      <ReducedMotionProvider>
        <Toast testID="toast" visible kind="info" message="Saved." onDismiss={jest.fn()} />
      </ReducedMotionProvider>,
    );
    await act(async () => {});
    expect(opacityOf("toast-fade")).toBe(1);
  });
});
