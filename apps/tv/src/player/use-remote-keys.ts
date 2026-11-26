// The one reader of the remote's hardware keys (T8-04 D2, D4). It names each key as the key rules know it. Only a key
// coming up is read: once react-native-tvos detects a hold it sends the `long…` name on a key down and again on key up.
// Back is not a hardware key event (use-player-back.ts).
import { useCallback, useRef } from "react";
import { useTVEventHandler, type TVRemoteEvent } from "react-native";
import type { ChromeKey } from "./chrome-keys";

// Android's KeyEvent.ACTION_UP.
const KEY_UP = 1;

// Every other key, the hardware `select` included, is only activity: it commands nothing. Every select is read from the
// focused Pressable's own press.
const COMMANDING_KEYS = new Map<string, ChromeKey>([
  ["up", "up"],
  ["down", "down"],
  ["left", "left"],
  ["right", "right"],
  ["longUp", "heldArrow"],
  ["longDown", "heldArrow"],
  ["longLeft", "heldArrow"],
  ["longRight", "heldArrow"],
  ["playPause", "playPause"],
  ["longPlayPause", "playPause"],
  ["play", "play"],
  ["pause", "pause"],
]);

export function useRemoteKeys(onKey: (key: ChromeKey) => void): void {
  const latest = useRef(onKey);
  latest.current = onKey;
  const handle = useCallback((event: TVRemoteEvent) => {
    // The library types this as a string; its Android helper sends a number.
    if (Number(event.eventKeyAction) !== KEY_UP) return;
    latest.current(COMMANDING_KEYS.get(event.eventType) ?? "activity");
  }, []);
  useTVEventHandler(handle);
}
