// Row memory (T3-08, decision 0004 condition 6): a row's scroll offset, keyed by a stable row id, held by the screen.
// The offset is the list's scroll offset in dp, as `onScroll` reports it and `scrollToOffset` takes it.
import { useRef } from "react";

export type RowMemory = {
  /** The remembered offset, or 0 for a row never scrolled. */
  get(rowId: string): number;
  set(rowId: string, offset: number): void;
};

export function createRowMemory(): RowMemory {
  const offsets = new Map<string, number>();
  return {
    get: (rowId) => offsets.get(rowId) ?? 0,
    set: (rowId, offset) => {
      offsets.set(rowId, offset);
    },
  };
}

/** One memory per mounted screen: the same object across re-renders, a new one on a fresh mount. */
export function useRowMemory(): RowMemory {
  const ref = useRef<RowMemory | null>(null);
  if (ref.current === null) ref.current = createRowMemory();
  return ref.current;
}
