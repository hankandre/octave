// A test double for the library's native TV event module (frozen with T8-04). Jest runs React Native as iOS, where
// `TVEventHandler.addListener` subscribes to nothing without this module, so every T8-04 file that sends a key starts with
//   jest.mock("../../node_modules/react-native/src/private/specs_DEPRECATED/modules/NativeTVNavigationEventEmitter",
//     () => require("./test-support/tv-emitter-double"));
// With it, the library's own `TVEventHandler` and `useTVEventHandler` hear the `onHWKeyEvent` device event.
const emitter = {
  addListener: (_eventName: string): void => undefined,
  removeListeners: (_count: number): void => undefined,
};

export default emitter;
