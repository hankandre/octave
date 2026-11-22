// One horizontal row of cards (T3-08), carrying decision 0004's measured focus fixes: maintainVisibleContentPosition
// off (no recycled-cell blur), a draw distance of ROW_DRAW_DISTANCE, a focus guide that traps Right (and Left when no
// rail is beside it), a scroll home when the first card takes focus, and a per-row scroll offset kept by the screen
// in a RowMemory under a stable row id. Nothing overrides focus: the native engine moves one card per press.
//
// testIDs, with r the row's testID: r, r-title, r-guide, r-list and r-card-<index>.
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { memo, useCallback, useLayoutEffect, useRef } from "react";
import { StyleSheet, Text, TVFocusGuideView, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { px } from "../scale";
import { textStyle } from "../text";
import { colors, space } from "../tokens";
import { MediaCard, type CardItem } from "./media-card";
import { cardGap, drawDistanceFor, rowInsetStart, rowListHeight, type CardVariant } from "./row-geometry";
import type { RowMemory } from "./row-memory";

export type MediaRowProps = {
  rowId: string;
  title: string;
  variant: CardVariant;
  items: CardItem[];
  memory: RowMemory;
  /** `trap` (default) holds Left on the first card; `open` lets Left leave the row for a rail. */
  leftEdge?: "trap" | "open";
  onCardFocus?: (rowId: string, index: number) => void;
  onCardBlur?: (rowId: string, index: number) => void;
  onCardPress?: (rowId: string, index: number) => void;
  testID: string;
};

type CellProps = {
  rowId: string;
  index: number;
  item: CardItem;
  variant: CardVariant;
  testID: string;
  onFocusCard: (rowId: string, index: number) => void;
  onBlurCard: (rowId: string, index: number) => void;
  onPressCard: (rowId: string, index: number) => void;
};

/** Binds a card's callbacks to the row id and index it shows now, never ones remembered from earlier. */
const RowCell = memo(function RowCell({ rowId, index, item, variant, testID, onFocusCard, onBlurCard, onPressCard }: CellProps) {
  const onFocus = useCallback(() => onFocusCard(rowId, index), [onFocusCard, rowId, index]);
  const onBlur = useCallback(() => onBlurCard(rowId, index), [onBlurCard, rowId, index]);
  const onPress = useCallback(() => onPressCard(rowId, index), [onPressCard, rowId, index]);
  return (
    <View style={styles.cell}>
      <MediaCard testID={testID} item={item} variant={variant} onFocus={onFocus} onBlur={onBlur} onPress={onPress} />
    </View>
  );
});

const keyOf = (item: CardItem): string => item.id;

export function MediaRow({ rowId, title, variant, items, memory, leftEdge = "trap", onCardFocus, onCardBlur, onCardPress, testID }: MediaRowProps) {
  const listRef = useRef<FlashListRef<CardItem>>(null);
  const shownId = useRef(rowId);
  const mounted = useRef(false);
  const handlers = useRef({ onCardFocus, onCardBlur, onCardPress });
  handlers.current = { onCardFocus, onCardBlur, onCardPress };

  // A recycled row view is handed another row id: restore that row's offset before paint. A fresh mount restores too.
  useLayoutEffect(() => {
    const handedOver = shownId.current !== rowId;
    shownId.current = rowId;
    const offset = memory.get(rowId);
    if (handedOver || (!mounted.current && offset > 0)) listRef.current?.scrollToOffset({ offset, animated: false });
    mounted.current = true;
  }, [rowId, memory]);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      memory.set(shownId.current, event.nativeEvent.contentOffset.x);
    },
    [memory],
  );

  const onFocusCard = useCallback(
    (id: string, index: number) => {
      handlers.current.onCardFocus?.(id, index);
      // The row's own left padding is not a press: scroll home when the first card takes focus.
      if (index === 0) {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
        memory.set(id, 0);
      }
    },
    [memory],
  );
  const onBlurCard = useCallback((id: string, index: number) => handlers.current.onCardBlur?.(id, index), []);
  const onPressCard = useCallback((id: string, index: number) => handlers.current.onCardPress?.(id, index), []);

  if (items.length === 0) return null;

  return (
    <View testID={testID}>
      <Text testID={`${testID}-title`} style={styles.title}>
        {title}
      </Text>
      <TVFocusGuideView testID={`${testID}-guide`} trapFocusRight trapFocusLeft={leftEdge === "trap"}>
        <FlashList
          ref={listRef}
          testID={`${testID}-list`}
          horizontal
          data={items}
          keyExtractor={keyOf}
          maintainVisibleContentPosition={{ disabled: true }}
          drawDistance={drawDistanceFor(variant)}
          showsHorizontalScrollIndicator={false}
          fadingEdgeLength={{ start: 0, end: px(space.safeX) }}
          contentContainerStyle={{ paddingLeft: px(rowInsetStart) }}
          style={{ height: px(rowListHeight(variant)) }}
          onScroll={onScroll}
          renderItem={({ item, index }) => (
            <RowCell
              rowId={rowId}
              index={index}
              item={item}
              variant={variant}
              testID={`${testID}-card-${index}`}
              onFocusCard={onFocusCard}
              onBlurCard={onBlurCard}
              onPressCard={onPressCard}
            />
          )}
        />
      </TVFocusGuideView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { ...textStyle("typeHeading"), color: colors.text1, marginBottom: px(space.space4), paddingLeft: px(rowInsetStart) },
  cell: { paddingRight: px(cardGap) },
});
