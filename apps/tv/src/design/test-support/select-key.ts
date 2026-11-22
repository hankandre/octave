// Test support for T3-06 item 6 (frozen). Simulates the select key on a TV remote as react-native-tvos documents it
// for Pressable (README lines 150 to 157): focus arrives first, `onPressIn` fires when select goes down, `onPressOut`
// when it comes up, and `onPress` when select is pressed. Jest has no focus engine, so this only delivers the events.
import { fireEvent } from "@testing-library/react-native";
import type { TestInstance } from "test-renderer";

const event = { nativeEvent: {} };

export async function pressSelect(element: TestInstance): Promise<void> {
  await fireEvent(element, "focus", event);
  await fireEvent(element, "pressIn", event);
  await fireEvent(element, "pressOut", event);
  await fireEvent(element, "press", event);
}
