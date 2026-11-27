// One horizontal row of cards (T3-08), carrying decision 0004's measured focus fixes: maintainVisibleContentPosition
// off (no recycled-cell blur), a draw distance of ROW_DRAW_DISTANCE, a focus guide that traps Right (and Left when no
// rail is beside it), a scroll home when the first card takes focus, and a per-row scroll offset kept by the screen
// in a RowMemory under a stable row id. Nothing overrides focus: the native engine moves one card per press.
// The row's end fades out, and its length is also Android's focus margin, so it stays on except while the last card has focus
// (T5-09): React Native draws it at full strength even at the end, where it would cover that card's ring and lift. The content
// ends `space.safeX` after the last card, so at rest the fade lies over empty space there.
//
// testIDs, with r the row's testID: r, r-title, r-guide, r-list and r-card-<index>.
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { memo, useCallback, useContext, useLayoutEffect, useRef, useState } from "react";
import { StyleSheet, Text, TVFocusGuideView, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { px } from "../scale";
import { textStyle } from "../text";
import { colors, space } from "../tokens";
import { LeftEdgeContext } from "./left-edge";
import { MediaCard, type CardItem } from "./media-card";
import { cardGap, cardTopInset, drawDistanceFor, rowEndInset, rowInsetStart, rowListHeight, type CardVariant } from "./row-geometry";
import type { RowMemory } from "./row-memory";
import type { RowRouter } from "./row-router";

export type MediaRowProps = {
  /** Set by `RowList`: points the rows above and below at their nearest card (see ./row-router). */
  router?: RowRouter;
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
  router?: RowRouter;
};

/** Binds a card's callbacks to the row id and index it shows now, never ones remembered from earlier. */
const RowCell = memo(function RowCell({ rowId, index, item, variant, testID, onFocusCard, onBlurCard, onPressCard, router }: CellProps) {
  const itemId = item.id;
  const viewRef = useCallback(
    (view: unknown) => {
      router?.registerCard(rowId, itemId, view);
    },
    [router, rowId, itemId],
  );
  const onFocus = useCallback(() => onFocusCard(rowId, index), [onFocusCard, rowId, index]);
  const onBlur = useCallback(() => onBlurCard(rowId, index), [onBlurCard, rowId, index]);
  const onPress = useCallback(() => onPressCard(rowId, index), [onPressCard, rowId, index]);
  return (
    <View style={styles.cell}>
      <MediaCard testID={testID} item={item} variant={variant} onFocus={onFocus} onBlur={onBlur} onPress={onPress} viewRef={viewRef} />
    </View>
  );
});

const keyOf = (item: CardItem): string => item.id;

const END_FADE = { start: 0, end: px(space.safeX) };
const NO_FADE = { start: 0, end: 0 };

export function MediaRow({ rowId, title, variant, items, memory, leftEdge: leftEdgeProp, onCardFocus, onCardBlur, onCardPress, router, testID }: MediaRowProps) {
  const inherited = useContext(LeftEdgeContext);
  const leftEdge = leftEdgeProp ?? inherited;
  const guideRef = useCallback(
    (guide: unknown) => {
      router?.registerGuide(rowId, guide as Parameters<RowRouter["registerGuide"]>[1]);
    },
    [router, rowId],
  );
  const listRef = useRef<FlashListRef<CardItem>>(null);
  const shownId = useRef(rowId);
  const mounted = useRef(false);
  const handlers = useRef({ onCardFocus, onCardBlur, onCardPress });
  handlers.current = { onCardFocus, onCardBlur, onCardPress };
  const lastIndex = useRef(items.length - 1);
  lastIndex.current = items.length - 1;
  // Which row's last card has focus. Held by row id, so a recycled row view never inherits another row's answer.
  const [lastCardRowId, setLastCardRowId] = useState<string>();

  // A recycled row view is handed another row id: restore that row's offset before paint. A fresh mount restores too.
  useLayoutEffect(() => {
    const handedOver = shownId.current !== rowId;
    shownId.current = rowId;
    const offset = memory.get(rowId);
    if (handedOver || (!mounted.current && offset > 0)) listRef.current?.scrollToOffset({ offset, animated: false });
    mounted.current = true;
  }, [rowId, memory]);

  // On a device the layout effect above runs before the list has content to scroll, so a fresh mount stays at 0
  // (milestone 5, decision log 12): restore once more when the list has laid out.
  const loaded = useRef(false);
  const onLoad = useCallback(() => {
    if (loaded.current) return;
    loaded.current = true;
    const offset = memory.get(shownId.current);
    if (offset > 0) listRef.current?.scrollToOffset({ offset, animated: false });
  }, [memory]);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      memory.set(shownId.current, event.nativeEvent.contentOffset.x);
      router?.scrolled(shownId.current);
    },
    [memory, router],
  );

  const onFocusCard = useCallback(
    (id: string, index: number) => {
      handlers.current.onCardFocus?.(id, index);
      // The row's own left padding is not a press: scroll home when the first card takes focus.
      if (index === 0) {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
        memory.set(id, 0);
      }
      setLastCardRowId(index === lastIndex.current ? id : undefined);
      router?.focused(id, index);
    },
    [memory, router],
  );
  const onBlurCard = useCallback((id: string, index: number) => {
    // On any blur: the card that had focus may no longer be the last, if the row's items changed under it.
    setLastCardRowId(undefined);
    handlers.current.onCardBlur?.(id, index);
  }, []);
  const onPressCard = useCallback((id: string, index: number) => handlers.current.onCardPress?.(id, index), []);

  if (items.length === 0) return null;

  return (
    <View testID={testID}>
      <Text testID={`${testID}-title`} style={styles.title}>
        {title}
      </Text>
      <TVFocusGuideView {...{ ref: guideRef }} testID={`${testID}-guide`} trapFocusRight trapFocusLeft={leftEdge === "trap"}>
        <FlashList
          ref={listRef}
          testID={`${testID}-list`}
          horizontal
          data={items}
          keyExtractor={keyOf}
          maintainVisibleContentPosition={{ disabled: true }}
          drawDistance={drawDistanceFor(variant)}
          showsHorizontalScrollIndicator={false}
          fadingEdgeLength={lastCardRowId === rowId ? NO_FADE : END_FADE}
          contentContainerStyle={{ paddingLeft: px(rowInsetStart), paddingRight: px(rowEndInset) }}
          style={{ height: px(rowListHeight(variant)) }}
          onScroll={onScroll}
          onLoad={onLoad}
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
              router={router}
            />
          )}
        />
      </TVFocusGuideView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { ...textStyle("typeHeading"), color: colors.text1, marginBottom: px(space.space4) - px(cardTopInset), paddingLeft: px(rowInsetStart) },
  // The top space holds the lift and the ring, so the art sits `space4` under the title.
  cell: { paddingRight: px(cardGap), paddingTop: px(cardTopInset) },
});
