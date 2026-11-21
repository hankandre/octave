// A placeholder first screen until T3-09's shell and T4's sign-in replace it: the product name over one row of five
// skeleton poster tiles (DESIGN.md §7.17). Its first tile takes focus when the screen mounts, so the first D-pad press
// moves focus instead of only leaving touch mode (T3-01 item 4). Each focus writes `OCTAVE_FOCUS tile-<n>` for the
// smoke test's oracle (scripts/tv-first-focus.mjs).
import { APP_NAME } from "@octave/core/src/domain/app-identity";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, sizes, typeTitle } from "./placeholder-values";

const TILES = [0, 1, 2, 3, 4];

function Tile({ index }: { index: number }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      testID={`tile-${index}`}
      focusable
      hasTVPreferredFocus={index === 0}
      onFocus={() => {
        setFocused(true);
        console.info(`OCTAVE_FOCUS tile-${index}`);
      }}
      onBlur={() => setFocused(false)}
      style={[styles.ring, focused && styles.ringFocused]}
    >
      <View style={styles.tile} />
    </Pressable>
  );
}

export function FirstScreen() {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{APP_NAME}</Text>
      <View style={styles.row}>
        {TILES.map((index) => (
          <Tile key={index} index={index} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface0,
    paddingHorizontal: sizes.safeX,
    paddingVertical: sizes.safeY,
  },
  title: {
    ...typeTitle,
    color: colors.text1,
    marginBottom: sizes.space7,
  },
  row: {
    flexDirection: "row",
    gap: sizes.space5 - 2 * (sizes.focusRingWidth + sizes.focusOffset),
  },
  ring: {
    padding: sizes.focusOffset,
    borderWidth: sizes.focusRingWidth,
    borderColor: "transparent",
    borderRadius: sizes.radiusArt + sizes.focusOffset + sizes.focusRingWidth,
  },
  ringFocused: {
    borderColor: colors.focus,
  },
  tile: {
    width: sizes.posterW,
    height: sizes.posterH,
    borderRadius: sizes.radiusArt,
    backgroundColor: colors.surface2,
  },
});
