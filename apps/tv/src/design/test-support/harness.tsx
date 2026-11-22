// Shared helpers for the frozen T3-06 component tests (items 3, 4 and 6). This file also fixes the props and testID
// contract that the controls must follow, so the tests and the implementation agree.
//
// testID contract
// - Every control takes `testID` (call it T). T sits on the ONE element that takes focus and select: the Pressable of
//   `FocusFrame`, or on TextField's fallback path the TextInput itself.
// - `FocusFrame` renders `<T>-scale` (the Animated.View that holds the children and the lift and press transforms)
//   and, only while focused, `<T>-focus-ring` (the inner ring overlay: ring colour and width in its style, as
//   `borderColor` and `borderWidth`, or `outlineColor` and `outlineWidth`).
// - A container passes its actions' testIDs as `<T>-<action id>`. Toast's Dismiss is `<T>-dismiss`. EmptyState's
//   action is `<T>-action`.
// - Dialog and Toast put their opacity on one element with testID `<T>-fade`; it is rendered only while visible.
// - TextField's native input has testID `<T>-input`.
//
// Props contract (all named exports from the module of the same name under `controls/`)
// - Button: label, variant ("primary" | "secondary" | "quiet" | "danger"), onPress, disabled, hasTVPreferredFocus, testID.
// - IconButton: icon (IconComponent), accessibilityLabel, onPress, disabled, testID.
// - TextField: label, value, onChangeText, onFocus, helper, error, disabled, hasTVPreferredFocus, testID.
// - Switch: value, onValueChange, disabled, accessibilityLabel, testID. It shows the words "On" or "Off".
// - Action (Dialog, Notice): { id, label, onPress, variant?, disabled? }.
// - Dialog: visible, title, message?, icon?, actions: Action[], initialFocus? (an action id), onDismiss, testID.
//   `onDismiss` is what the Modal's `onRequestClose` calls.
// - Toast: visible, kind ("info" | "error"), message, icon?, onDismiss, testID.
// - Notice: title, message, itemTitle?, icon?, actions: Action[], testID.
// - EmptyState: title, message, icon?, action? { label, onPress, disabled? }, testID.
// - Skeleton: testID. It renders after `skeletonDelayMs` and exposes nothing focusable.
// - ReducedMotionProvider (../motion): value? (a boolean override). Without it, the provider reads AccessibilityInfo.
//
// No literal design value appears here, so `octave/design-tokens` has nothing to report in this file.
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { render, screen } from "@testing-library/react-native";
import type { TestInstance } from "test-renderer";
import { ReducedMotionProvider } from "../motion";

export function TestIcon({ size, color }: { size: number; color: string }): ReactElement {
  return <View testID="test-icon" style={{ width: size, height: size, backgroundColor: color }} />;
}

export function renderWith(ui: ReactElement, reduced: boolean) {
  return render(<ReducedMotionProvider value={reduced}>{ui}</ReducedMotionProvider>);
}

export function flat(element: TestInstance): Record<string, any> {
  return (StyleSheet.flatten(element.props.style) ?? {}) as Record<string, any>;
}

/** The `scale` of the element's transform, or null when it has no transform at all. */
export function scaleOf(element: TestInstance): unknown {
  const transform = flat(element).transform;
  if (!Array.isArray(transform)) return null;
  for (const entry of transform) {
    if (entry !== null && typeof entry === "object" && "scale" in entry) return (entry as { scale: unknown }).scale;
  }
  return null;
}

export function hasTransform(element: TestInstance): boolean {
  const transform = flat(element).transform;
  return Array.isArray(transform) && transform.length > 0;
}

export function focusableElements(): TestInstance[] {
  return screen.container.queryAll((instance) => instance.props.focusable === true);
}

export function ringColor(style: Record<string, any>): unknown {
  return style.borderColor ?? style.outlineColor;
}

export function ringWidth(style: Record<string, any>): unknown {
  return style.borderWidth ?? style.outlineWidth;
}
