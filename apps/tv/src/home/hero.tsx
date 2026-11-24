// The hero (DESIGN.md §7.3, T5-03 D4, D5, D8): the title, one facts line, at most two lines of overview, and the action bar
// (Resume or Play, then More info). The facts and overview slots have fixed heights, so the detail arriving later moves nothing.
// A button sits in a plain View (`home-hero-<action>-slot`) that reports its layout, because Button and FocusFrame take no
// `onLayout`; that frame's x is relative to the action bar, which starts `rowInsetStart` in from the hero's left.
//
// testIDs: home-hero-title, home-hero-facts-slot, home-hero-facts, home-hero-overview-slot, home-hero-overview,
// home-hero-primary-slot, home-hero-primary, home-hero-more-info-slot, home-hero-more-info.
import { useCallback, useRef, type RefObject } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Button } from "../design/controls/button";
import { useFocusPlace, rowInsetStart, type RowListEntry } from "../design/rows";
import { canvasScale, px } from "../design/scale";
import { textStyle } from "../design/text";
import { colors, space, textLayout, type as typeTokens } from "../design/tokens";

export type HeroAction = "primary" | "more-info";

export type HeroProps = {
  title: string;
  facts: string;
  overview?: string;
  /** Absent when there is nothing to play (a series with no next episode): More info is then the opening action. */
  primaryLabel?: string;
  onPrimary: () => void;
  onMoreInfo: () => void;
  /** A hero button took focus, before the rows are told. */
  onFocusAction: (action: HeroAction) => void;
  entryRef: RefObject<RowListEntry | null>;
};

type Frame = { x: number; width: number };

const OVERVIEW_LINES = 2;
const AVERAGE_GLYPH = 0.5;

export function Hero({ title, facts, overview, primaryLabel, onPrimary, onMoreInfo, onFocusAction, entryRef }: HeroProps) {
  const place = useFocusPlace();
  const opening: HeroAction = primaryLabel === undefined ? "more-info" : "primary";
  const views = useRef<Record<HeroAction, unknown>>({ primary: null, "more-info": null });
  const frames = useRef<Partial<Record<HeroAction, Frame>>>({});

  const viewRef = useCallback(
    (action: HeroAction) => (view: unknown) => {
      views.current[action] = view;
      if (view !== null && action === opening) place.opening(view);
    },
    [opening, place],
  );
  const primaryRef = useCallback((view: unknown) => viewRef("primary")(view), [viewRef]);
  const moreInfoRef = useCallback((view: unknown) => viewRef("more-info")(view), [viewRef]);

  const layoutOf = (action: HeroAction) => (event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    frames.current[action] = { x, width };
  };

  /** The button's horizontal centre in canvas px: the action bar's own offset (dp) plus the slot's x and half its width. */
  const centreOf = (action: HeroAction): number => {
    const frame = frames.current[action];
    if (frame === undefined) return rowInsetStart;
    return (px(rowInsetStart) + frame.x + frame.width / 2) / canvasScale();
  };

  const focusAction = (action: HeroAction) => () => {
    onFocusAction(action);
    place.focused(`hero-${action}`, views.current[action]);
    entryRef.current?.fromHeader(centreOf(action));
  };

  return (
    <View style={styles.hero}>
      <Text testID="home-hero-title" numberOfLines={2} style={styles.title}>
        {title}
      </Text>
      <View testID="home-hero-facts-slot" style={styles.factsSlot}>
        <Text testID="home-hero-facts" numberOfLines={1} style={styles.facts}>
          {facts}
        </Text>
      </View>
      <View testID="home-hero-overview-slot" style={styles.overviewSlot}>
        {overview === undefined || overview === "" ? null : (
          <Text testID="home-hero-overview" numberOfLines={OVERVIEW_LINES} style={styles.overview}>
            {overview}
          </Text>
        )}
      </View>
      <View style={styles.actions}>
        {primaryLabel === undefined ? null : (
          <View testID="home-hero-primary-slot" onLayout={layoutOf("primary")}>
            <Button testID="home-hero-primary" label={primaryLabel} variant="primary" onPress={onPrimary} hasTVPreferredFocus viewRef={primaryRef} onFocus={focusAction("primary")} />
          </View>
        )}
        <View testID="home-hero-more-info-slot" onLayout={layoutOf("more-info")}>
          <Button
            testID="home-hero-more-info"
            label="More info"
            variant={primaryLabel === undefined ? "primary" : "secondary"}
            onPress={onMoreInfo}
            hasTVPreferredFocus={primaryLabel === undefined}
            viewRef={moreInfoRef}
            onFocus={focusAction("more-info")}
          />
        </View>
      </View>
    </View>
  );
}

const overviewLine = typeTokens.typeBodyLg.size * typeTokens.typeBodyLg.lineHeight;
const factsLine = typeTokens.typeMeta.size * typeTokens.typeMeta.lineHeight;

const styles = StyleSheet.create({
  hero: { paddingTop: px(space.safeY), paddingBottom: px(space.space7), paddingRight: px(space.safeX) },
  title: { ...textStyle("typeHero"), color: colors.text1, marginLeft: px(rowInsetStart) },
  factsSlot: { height: px(factsLine), marginTop: px(space.space4), marginLeft: px(rowInsetStart) },
  facts: { ...textStyle("typeMeta"), color: colors.text2 },
  overviewSlot: { height: px(overviewLine * OVERVIEW_LINES), marginTop: px(space.space3), marginLeft: px(rowInsetStart), maxWidth: px(typeTokens.typeBodyLg.size * AVERAGE_GLYPH * textLayout.measure) },
  overview: { ...textStyle("typeBodyLg"), color: colors.text2 },
  actions: { flexDirection: "row", gap: px(space.space4), marginTop: px(space.space6), marginLeft: px(rowInsetStart) },
});
