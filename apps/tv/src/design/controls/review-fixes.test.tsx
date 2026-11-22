// T3-06 review fixes (not frozen): an inline onDismiss does not restart the Toast timer, and a TextField keeps its
// ring while its native input has focus.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { useState } from "react";
import { motion } from "../tokens";
import { TextField } from "./text-field";
import { Toast } from "./toast";
import { renderWith } from "../test-support/harness";

const event = { nativeEvent: {} };

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
});
afterEach(() => {
  jest.useRealTimers();
});

function Busy({ onDismiss }: { onDismiss: () => void }) {
  const [, setTick] = useState(0);
  // Re-renders every second, handing Toast a new inline callback each time.
  setTimeout(() => setTick((n) => n + 1), 1000);
  return <Toast testID="toast" visible kind="info" message="Saved." onDismiss={() => onDismiss()} />;
}

describe("Toast with an inline onDismiss", () => {
  it("still dismisses toastMs after it showed, however often the parent re-renders", async () => {
    const onDismiss = jest.fn();
    await renderWith(<Busy onDismiss={onDismiss} />, false);
    for (let elapsed = 0; elapsed < motion.toastMs; elapsed += 1000) {
      await act(async () => {
        jest.advanceTimersByTime(Math.min(1000, motion.toastMs - elapsed));
      });
    }
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("TextField focus ring", () => {
  it("holds while the input has focus, even after the frame blurs, and goes when the input blurs", async () => {
    await renderWith(<TextField testID="field" label="Name" value="" onChangeText={jest.fn()} />, false);
    const frame = screen.getByTestId("field");
    const input = screen.getByTestId("field-input");
    await fireEvent(frame, "focus", event);
    await fireEvent(input, "focus", event);
    await fireEvent(frame, "blur", event);
    expect(screen.getByTestId("field-focus-ring")).toBeTruthy();
    await fireEvent(input, "blur", event);
    expect(screen.queryByTestId("field-focus-ring")).toBeNull();
  });
});
