// The remote for the T8-04 Jest files (frozen with T8-04; spec D4, "One press in a test"). A file that uses it mocks the
// native TV event module with ./tv-emitter-double.
import { act } from "@testing-library/react-native";
import { DeviceEventEmitter } from "react-native";
import type { TestInstance } from "test-renderer";
import { pressSelect } from "../../design/test-support/select-key";

// Android's KeyEvent.ACTION_UP: react-native-tvos sends a key's hardware event when the key comes up.
const KEY_UP = 1;

/** One key's hardware event, named as react-native-tvos names it. Never `select`: use `pressRemoteSelect` for that. */
export async function pressRemoteKey(name: string): Promise<void> {
  await act(async () => {
    DeviceEventEmitter.emit("onHWKeyEvent", { eventType: name, eventKeyAction: KEY_UP });
  });
}

/**
 * One select press on the focused element, delivered once on both paths in the order a device uses: the hardware
 * `select` event first, then the focused Pressable's own press.
 */
export async function pressRemoteSelect(element: TestInstance): Promise<void> {
  await pressRemoteKey("select");
  await pressSelect(element);
}
