// Skeleton (DESIGN.md §7.17): a `surface2` block shaped like the content, shown only after `skeletonDelayMs`. It
// never shimmers, under any setting. It is a placeholder: it takes no focus and no select.
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { px } from "../scale";
import { colors, motion, radii } from "../tokens";

export type SkeletonProps = {
  /** Canvas px; omit to fill the parent. */
  width?: number;
  height?: number;
  radius?: keyof typeof radii;
  testID?: string;
};

export function Skeleton({ width, height, radius = "radiusArt", testID }: SkeletonProps) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), motion.skeletonDelayMs);
    return () => clearTimeout(timer);
  }, []);
  const size = { width: width === undefined ? undefined : px(width), height: height === undefined ? undefined : px(height), borderRadius: px(radii[radius]) };
  return <View style={size}>{shown ? <View testID={testID} style={[styles.block, { borderRadius: px(radii[radius]) }]} /> : null}</View>;
}

const styles = StyleSheet.create({
  block: { width: "100%", height: "100%", backgroundColor: colors.surface2 },
});
