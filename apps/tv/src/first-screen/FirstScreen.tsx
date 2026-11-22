// A placeholder first screen until T3-09's shell and T4's sign-in replace it: the product name over one row of five
// skeleton poster tiles (DESIGN.md §7.17). Its first tile takes focus when the screen mounts, so the first D-pad press
// moves focus instead of only leaving touch mode (T3-01 item 4). Each focus writes `OCTAVE_FOCUS tile-<n>` for the
// smoke test's oracle (scripts/tv-first-focus.mjs).
import { APP_NAME } from "@octave/core/src/domain/app-identity";
import { StyleSheet, Text, View } from "react-native";
import { FocusFrame } from "../design/focus-frame";
import { px } from "../design/scale";
import { textStyle } from "../design/text";
import { colors, radii, sizes, space } from "../design/tokens";

const TILES = [0, 1, 2, 3, 4];

function Tile({ index }: { index: number }) {
  return (
    <FocusFrame
      testID={`tile-${index}`}
      hasTVPreferredFocus={index === 0}
      radius="radiusArt"
      onFocus={() => console.info(`OCTAVE_FOCUS tile-${index}`)}
      contentStyle={styles.tile}
    >
      {null}
    </FocusFrame>
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
    paddingHorizontal: px(space.safeX),
    paddingVertical: px(space.safeY),
  },
  title: {
    ...textStyle("typeTitle"),
    color: colors.text1,
    marginBottom: px(space.space7),
  },
  row: {
    flexDirection: "row",
    gap: px(space.space5),
  },
  tile: {
    width: px(sizes.posterW),
    height: px(sizes.posterW * 1.5),
    borderRadius: px(radii.radiusArt),
    backgroundColor: colors.surface2,
  },
});
