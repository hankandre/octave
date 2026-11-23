// The placeholder every route shows until its own task replaces it (T3-09's shell holds it): the product name over one row of five
// skeleton poster tiles (DESIGN.md §7.17). Its first tile takes focus when the screen mounts, so the first D-pad press
// moves focus instead of only leaving touch mode (T3-01 item 4). Each focus writes `OCTAVE_FOCUS tile-<n>` for the
// smoke test's oracle (scripts/tv-first-focus.mjs).
import { APP_NAME } from "@octave/core/src/domain/app-identity";
import { useCallback, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { FocusFrame } from "../design/focus-frame";
import { useFocusPlace } from "../design/rows";
import { px } from "../design/scale";
import { textStyle } from "../design/text";
import { colors, radii, sizes, space } from "../design/tokens";
import { chromeOf, type Route } from "../shell/routes";

const TILES = [0, 1, 2, 3, 4];

function Tile({ index }: { index: number }) {
  const place = useFocusPlace();
  const view = useRef<unknown>(null);
  const viewRef = useCallback(
    (instance: unknown) => {
      view.current = instance;
      if (index === 0 && instance !== null) place.opening(instance);
    },
    [index, place],
  );
  return (
    <FocusFrame
      testID={`tile-${index}`}
      viewRef={viewRef}
      hasTVPreferredFocus={index === 0}
      radius="radiusArt"
      onFocus={() => {
        place.focused(`tile-${index}`, view.current);
        console.info(`OCTAVE_FOCUS tile-${index}`);
      }}
      contentStyle={styles.tile}
    >
      {null}
    </FocusFrame>
  );
}

export function FirstScreen({ route }: { route?: Route }) {
  const beside = route !== undefined && chromeOf(route) === "rail";
  return (
    <View style={[styles.screen, beside ? styles.besideRail : undefined]}>
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
  // The shell's content already starts after the collapsed rail.
  besideRail: { paddingLeft: 0 },
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
