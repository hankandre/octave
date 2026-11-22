// The rows of a browse screen (T3-08): one vertical FlashList of `MediaRow`s, each with the same leading inset so every
// row's cards share one x frame. Nothing overrides vertical focus, so the native engine picks the adjacent row's card
// nearest the same horizontal position (the rule is `nearestCardIndex` in ./row-geometry). Empty rows render nothing.
// The screen owns the memory: `useRowMemory()`.
//
// testIDs, with l the list's testID: l-list and l-row-<rowId> (each row's testID, so l-row-<rowId>-title and so on).
import { FlashList } from "@shopify/flash-list";
import { useMemo, type ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { px } from "../scale";
import { sizes } from "../tokens";
import { MediaRow } from "./media-row";
import type { CardItem } from "./media-card";
import type { CardVariant } from "./row-geometry";
import type { RowMemory } from "./row-memory";

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
            leftEdge={leftEdge}
            onCardFocus={onCardFocus}
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
