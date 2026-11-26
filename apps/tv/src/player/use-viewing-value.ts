// One value of the viewing's state. A component redraws only when the value it selects changes, so the engine's
// one-second position events redraw the scrubber alone.
import { useCallback, useSyncExternalStore } from "react";
import type { ViewingState } from "@octave/core/src/player/viewing";
import type { PlayerServices } from "./player-services";

export function useViewingValue<Value>(viewing: PlayerServices["viewing"], select: (state: ViewingState) => Value): Value {
  const subscribe = useCallback((listener: () => void) => viewing.subscribe(listener), [viewing]);
  return useSyncExternalStore(subscribe, () => select(viewing.state()));
}
