// The player's OSD (DESIGN.md §7.14): one line in a pill at top centre, over the picture. It takes no focus and does not
// animate. testID: player-osd.
import { StyleSheet, Text, View } from "react-native";
import { px } from "../design/scale";
import { textStyle } from "../design/text";
import { colors, motion, radii, space } from "../design/tokens";

/** How long a line no key asked for stays: the owner's five seconds, the token a toast also lasts. */
export const OSD_NOTICE_MS = motion.toastMs;

export function PlayerOsd({ message }: { message: string }) {
  return (
    <View style={styles.place}>
      <View testID="player-osd" style={styles.pill} accessibilityLiveRegion="polite">
        <Text numberOfLines={1} style={styles.message}>
          {message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  place: { position: "absolute", top: px(space.safeY), left: px(space.safeX), right: px(space.safeX), alignItems: "center" },
  pill: {
    paddingVertical: px(space.space3),
    paddingHorizontal: px(space.space6),
    borderRadius: px(radii.radiusPill),
    backgroundColor: colors.surface1,
  },
  message: { ...textStyle("typeBody"), color: colors.text1 },
});
