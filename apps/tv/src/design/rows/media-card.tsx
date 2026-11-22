// The media card (T3-08, DESIGN.md §7.5): a poster (2:3) or a thumb (16:9) with the title, subtitle, progress bar and
// played mark. Exactly one element takes focus: the Pressable. Focus is the F4 look of decision 0004's addendum: a
// static lift set at once (no animation), the two-tone ring and `shadowLift`. Artwork comes through the slot in
// ./artwork, which gets an ImageRef and the drawn size and nothing else.
//
// testIDs, with c the card's testID: c (the Pressable), c-art (the art frame), c-focus-ring, c-artwork, c-missing,
// c-title, c-subtitle, c-progress, c-progress-fill, c-played.
import { memo, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ImageRef } from "@octave/core/src/domain/catalog";
import { FocusRing } from "../focus-frame";
import { useReducedMotion } from "../motion";
import { px } from "../scale";
import { textStyle } from "../text";
import { artDefaults, blackAt, colors, depth, motion, radii, sizes, space } from "../tokens";
import { useArtwork } from "./artwork";
import { cardHeight, cardTextGap, cardWidth, type CardVariant } from "./row-geometry";

export type CardItem = {
  id: string;
  title: string;
  subtitle?: string;
  image?: ImageRef;
  /** 0 to 1, only when partly watched. */
  progress?: number;
  /** True only when watched. */
  played?: boolean;
  accessibilityLabel?: string;
};

export type MediaCardProps = {
  item: CardItem;
  variant: CardVariant;
  onFocus?: () => void;
  onBlur?: () => void;
  onPress?: () => void;
  hasTVPreferredFocus?: boolean;
  testID: string;
};

const shadow = depth.shadowLift;
const fill = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;
const PLAYED_ICON = sizes.markDisc - 2 * space.space1;

function MediaCardView({ item, variant, onFocus, onBlur, onPress, hasTVPreferredFocus, testID }: MediaCardProps) {
  const reduced = useReducedMotion();
  const { component: Artwork, playedIcon: PlayedIcon } = useArtwork();
  const [focused, setFocused] = useState(false);
  const [failedFor, setFailedFor] = useState<string | null>(null);

  // A recycled card does not inherit another item's failure.
  useEffect(() => {
    setFailedFor((current) => (current === item.id ? current : null));
  }, [item.id]);

  const width = cardWidth(variant);
  const height = cardHeight(variant);
  const failed = failedFor === item.id;
  const image = item.image;
  const showArtwork = Artwork !== undefined && image !== undefined && !failed;
  const progress = item.progress ?? 0;
  const showProgress = item.played !== true && progress > 0 && progress < 1;
  const label = item.accessibilityLabel ?? (item.subtitle ? `${item.title}, ${item.subtitle}` : item.title);

  return (
    <Pressable
      testID={testID}
      focusable
      accessibilityRole="button"
      accessibilityLabel={label}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => {
        setFocused(false);
        onBlur?.();
      }}
      style={{ width: px(width) }}
    >
      <View
        testID={`${testID}-art`}
        style={[
          { width: px(width), height: px(height), borderRadius: px(radii.radiusArt) },
          focused ? { transform: reduced ? undefined : [{ scale: motion.lift }], boxShadow: [{ offsetX: px(shadow.offsetX), offsetY: px(shadow.offsetY), blurRadius: px(shadow.blur), spreadDistance: px(shadow.spread), color: blackAt(shadow.alpha) }] } : undefined,
        ]}
      >
        <View style={styles.clip}>
          {showArtwork && Artwork !== undefined && image !== undefined ? (
            <View style={fill}>
              <Artwork image={image} width={width} height={height} onFailed={() => setFailedFor(item.id)} testID={`${testID}-artwork`} />
            </View>
          ) : (
            <View testID={`${testID}-missing`} style={styles.missing}>
              <Text numberOfLines={2} style={styles.missingTitle}>
                {item.title}
              </Text>
            </View>
          )}
          {item.played === true ? (
            <View testID={`${testID}-played`} style={styles.played}>
              {PlayedIcon ? <PlayedIcon size={px(PLAYED_ICON)} color={colors.text1} /> : null}
            </View>
          ) : null}
          {showProgress ? (
            <View testID={`${testID}-progress`} style={styles.track}>
              <View testID={`${testID}-progress-fill`} style={[styles.fill, { width: `${progress * 100}%` }]} />
            </View>
          ) : null}
        </View>
        {focused ? <FocusRing radius="radiusArt" testID={`${testID}-focus-ring`} /> : null}
      </View>
      <Text testID={`${testID}-title`} numberOfLines={1} style={[styles.title, { color: focused ? colors.text1 : colors.text2 }]}>
        {item.title}
      </Text>
      {item.subtitle ? (
        <Text testID={`${testID}-subtitle`} numberOfLines={1} style={styles.subtitle}>
          {item.subtitle}
        </Text>
      ) : null}
    </Pressable>
  );
}

export const MediaCard = memo(MediaCardView);

const styles = StyleSheet.create({
  clip: { ...fill, borderRadius: px(radii.radiusArt), overflow: "hidden" },
  missing: { ...fill, backgroundColor: colors.surface2, alignItems: "center", justifyContent: "center", padding: px(space.space3) },
  missingTitle: { ...textStyle("typeLabel"), color: colors.text2, textAlign: "center" },
  played: {
    position: "absolute",
    top: px(space.space3),
    right: px(space.space3),
    width: px(sizes.markDisc),
    height: px(sizes.markDisc),
    borderRadius: px(radii.radiusPill),
    backgroundColor: colors.veil,
    alignItems: "center",
    justifyContent: "center",
  },
  track: { position: "absolute", left: 0, right: 0, bottom: 0, height: px(sizes.cardProgressH), backgroundColor: colors.track },
  fill: { height: "100%", backgroundColor: artDefaults.artAccent },
  title: { ...textStyle("typeLabel"), marginTop: px(cardTextGap) },
  subtitle: { ...textStyle("typeMeta"), color: colors.text2 },
});
