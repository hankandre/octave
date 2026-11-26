// Jest has no focus engine (frozen with T8-04). These helpers read which view the screen asked the focus bridge's double
// to focus, and deliver the blur and focus events a device would then send. A view is named by its accessibility label.
// A file that uses them mocks `shell/focus-bridge` with its frozen double.
import { fireEvent, screen } from "@testing-library/react-native";
import { focusView } from "../../shell/test-support/focus-bridge-double";

const event = { nativeEvent: {} };

export function labelOf(view: unknown): string | undefined {
  if (view === null || typeof view !== "object") return undefined;
  const props = (view as { props?: { accessibilityLabel?: unknown } }).props;
  return typeof props?.accessibilityLabel === "string" ? props.accessibilityLabel : undefined;
}

/** The label of every view the screen asked to take focus since the last `focusView.mockClear()`, in order. */
export const focusRequests = (): (string | undefined)[] => focusView.mock.calls.map(([view]) => labelOf(view));

export const lastFocusRequest = (): string | undefined => focusRequests().at(-1);

export function focusTracker() {
  let focused: string | undefined;

  /** Moves focus to the element with this label, as the platform would. */
  async function moveTo(label: string): Promise<void> {
    const previous = focused === undefined ? null : screen.queryByLabelText(focused);
    if (previous !== null && focused !== label) await fireEvent(previous, "blur", event);
    focused = label;
    await fireEvent(screen.getByLabelText(label), "focus", event);
  }

  /** Lands focus where the screen last asked for it. */
  async function follow(): Promise<void> {
    const label = lastFocusRequest();
    if (label === undefined) throw new Error("the screen asked no labelled view to take focus");
    await moveTo(label);
  }

  return { moveTo, follow };
}
