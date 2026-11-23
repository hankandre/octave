// The rows of a browse screen (T3-08): one vertical FlashList of `MediaRow`s, each with the same leading inset so every
// row's cards share one x frame. Vertical focus goes to the adjacent row's card nearest the same horizontal position
// (the rule is `nearestCardIndex` in ./row-geometry; ./row-router tells each row's focus guide which card that is,
// because the native search alone missed it from a thumb row up to a poster row). Empty rows render nothing.
// The screen owns the memory: `useRowMemory()`.
//
// testIDs, with l the list's testID: l-list and l-row-<rowId> (each row's testID, so l-row-<rowId>-title and so on).
import { FlashList } from "@shopify/flash-list";
import { useCallback, useEffect, useMemo, useRef, type ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { px } from "../scale";
import { sizes } from "../tokens";
import { useFocusPlace } from "./focus-place-context";
import { MediaRow } from "./media-row";
import type { CardItem } from "./media-card";
import type { CardVariant } from "./row-geometry";
import type { RowMemory } from "./row-memory";
import { createRowRouter } from "./row-router";

export type RowSpec = { id: string; title: string; variant: CardVariant; items: CardItem[] };

export type RowListProps = {
  rows: RowSpec[];
  memory: RowMemory;
  leftEdge?: "trap" | "open";
  header?: ReactElement;
  onCardFocus?: (rowId: string, index: number) => void;
  onCardBlur?: (rowId: string, index: number) => void;
  onCardPress?: (rowId: string, index: number) => void;
  testID: string;
};

const keyOf = (row: RowSpec): string => row.id;
const typeOf = (row: RowSpec): CardVariant => row.variant;

export function RowList({ rows, memory, leftEdge, header, onCardFocus, onCardBlur, onCardPress, testID }: RowListProps) {
  const shown = useMemo(() => rows.filter((row) => row.items.length > 0), [rows]);
  const router = useMemo(() => createRowRouter(memory), [memory]);
  router.update(shown);
  const place = useFocusPlace();
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const handlers = useRef({ onCardFocus });
  handlers.current = { onCardFocus };

  // The shell asks for the rows' views, their ids and a way to clear the guides; a card focus is reported with its view.
  useEffect(() => {
    place.rows({ clear: () => router.clear(), viewOf: (rowId, itemId) => router.viewOf(rowId, itemId), rows: () => shownRef.current });
    return () => place.rows(null);
  }, [place, router]);
  const reportFocus = useCallback(
    (rowId: string, index: number) => {
      const item = shownRef.current.find((row) => row.id === rowId)?.items[index];
      if (item !== undefined) place.focused(`card:${rowId}:${item.id}`, router.viewOf(rowId, item.id), { rowId, itemId: item.id, index });
      handlers.current.onCardFocus?.(rowId, index);
    },
    [place, router],
  );
  return (
    <FlashList
      testID={`${testID}-list`}
      data={shown}
      keyExtractor={keyOf}
      getItemType={typeOf}
      ListHeaderComponent={header}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <MediaRow
            testID={`${testID}-row-${item.id}`}
            rowId={item.id}
            title={item.title}
            variant={item.variant}
            items={item.items}
            memory={memory}
            router={router}
            leftEdge={leftEdge}
            onCardFocus={reportFocus}
            onCardBlur={onCardBlur}
            onCardPress={onCardPress}
          />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: { marginBottom: px(sizes.rowGap) },
});
