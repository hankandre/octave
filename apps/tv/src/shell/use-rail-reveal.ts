// Keeps the rail's focused entry in view (T3-40): a library comes into view with room for its ring, Search takes the
// list to its start and Settings to its end, so nothing sits under either ring. This runs on focus, and again while the
// entry holds focus if its place or either height changes, as when more libraries load above it. Until the sizes it
// needs are measured, it does not scroll. The list neither scrolls a focused child itself nor animates: two scrolls
// racing could leave the entry flush with the edge.
import { useCallback, useMemo, useRef } from "react";
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollViewInstance } from "react-native";
import { px } from "../design/scale";
import { sizes } from "../design/tokens";
import type { RailKey } from "./rail-entries";
import { revealOffset } from "./rail-reveal";

export function useRailReveal(room: number) {
  const list = useRef<ScrollViewInstance>(null);
  const focused = useRef<RailKey | undefined>(undefined);
  const offset = useRef(0);
  const viewport = useRef<number | undefined>(undefined);
  const content = useRef<number | undefined>(undefined);
  const tops = useRef(new Map<RailKey, number>());

  /** Where the list belongs for an entry, or `undefined` while a size that decides it is unknown. */
  const offsetFor = useCallback(
    (key: RailKey): number | undefined => {
      if (key === "search") return 0;
      if (viewport.current === undefined || content.current === undefined) return undefined;
      if (key === "settings") return Math.max(0, content.current - viewport.current);
      const top = tops.current.get(key);
      if (top === undefined) return undefined;
      return revealOffset({ offset: offset.current, top, height: px(sizes.hitMin), room, viewport: viewport.current, content: content.current });
    },
    [room],
  );

  const reveal = useCallback(() => {
    if (focused.current === undefined) return;
    const y = offsetFor(focused.current);
    if (y === undefined) return;
    offset.current = y;
    list.current?.scrollTo({ y, animated: false });
  }, [offsetFor]);

  const entryFocused = useCallback(
    (key: RailKey) => {
      focused.current = key;
      reveal();
    },
    [reveal],
  );

  const entryBlurred = useCallback((key: RailKey) => {
    if (focused.current === key) focused.current = undefined;
  }, []);

  const entryLaidOut = useCallback(
    (key: RailKey, top: number) => {
      if (tops.current.get(key) === top) return;
      tops.current.set(key, top);
      if (focused.current === key) reveal();
    },
    [reveal],
  );

  const listProps = useMemo(
    () => ({
      ref: list,
      scrollsChildToFocus: false,
      scrollAnimationEnabled: false,
      onLayout: (event: LayoutChangeEvent) => {
        const { height } = event.nativeEvent.layout;
        if (viewport.current === height) return;
        viewport.current = height;
        reveal();
      },
      onContentSizeChange: (_width: number, height: number) => {
        if (content.current === height) return;
        content.current = height;
        reveal();
      },
      onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        offset.current = event.nativeEvent.contentOffset.y;
      },
    }),
    [reveal],
  );

  return { listProps, entryFocused, entryBlurred, entryLaidOut };
}
