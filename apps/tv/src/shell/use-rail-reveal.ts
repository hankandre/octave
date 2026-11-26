// Scrolls the rail's list when an entry takes focus (T3-40): a library comes into view with room for its ring, Search
// takes the list to its start and Settings to its end, so nothing sits under either ring. The list neither scrolls a
// focused child itself nor animates: two scrolls racing could leave the entry flush with the edge.
import { useCallback, useMemo, useRef } from "react";
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollViewInstance } from "react-native";
import { px } from "../design/scale";
import { sizes } from "../design/tokens";
import type { RailKey } from "./rail-entries";
import { revealOffset } from "./rail-reveal";

export function useRailReveal(room: number) {
  const list = useRef<ScrollViewInstance>(null);
  const offset = useRef(0);
  const viewport = useRef(0);
  const content = useRef(0);
  const tops = useRef(new Map<RailKey, number>());

  const scrollTo = useCallback((y: number) => {
    offset.current = y;
    list.current?.scrollTo({ y, animated: false });
  }, []);

  const entryFocused = useCallback(
    (key: RailKey) => {
      if (key === "search") {
        scrollTo(0);
        return;
      }
      if (key === "settings") {
        scrollTo(Math.max(0, content.current - viewport.current));
        return;
      }
      const top = tops.current.get(key);
      if (top === undefined) return;
      scrollTo(revealOffset({ offset: offset.current, top, height: px(sizes.hitMin), room, viewport: viewport.current, content: content.current }));
    },
    [room, scrollTo],
  );

  const entryLaidOut = useCallback((key: RailKey, top: number) => {
    tops.current.set(key, top);
  }, []);

  const listProps = useMemo(
    () => ({
      ref: list,
      scrollsChildToFocus: false,
      scrollAnimationEnabled: false,
      onLayout: (event: LayoutChangeEvent) => {
        viewport.current = event.nativeEvent.layout.height;
      },
      onContentSizeChange: (_width: number, height: number) => {
        content.current = height;
      },
      onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        offset.current = event.nativeEvent.contentOffset.y;
      },
    }),
    [],
  );

  return { listProps, entryFocused, entryLaidOut };
}
