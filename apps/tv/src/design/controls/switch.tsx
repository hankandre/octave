// Switch (DESIGN.md §7.18): a pill track (`switchW` by `switchH`) with a round thumb and the words "On" or "Off"
// beside it, so the state is never colour alone. On is a `text1` track with an `onLight` thumb, off is a `surface3`
// track with a `text2` thumb. The thumb moves over `durQuick`, at once under reduced motion.
import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text } from "react-native";
import { FocusFrame } from "../focus-frame";
import { useReducedMotion } from "../motion";
import { px } from "../scale";
import { textStyle } from "../text";
import { colors, motion, radii, sizes, space } from "../tokens";

export type SwitchProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  accessibilityLabel: string;
  disabled?: boolean;
  hasTVPreferredFocus?: boolean;
  testID?: string;
};

const pad = (sizes.switchH - sizes.switchThumb) / 2;
const travel = sizes.switchW - sizes.switchThumb - 2 * pad;

export function Switch({ value, onValueChange, accessibilityLabel, disabled = false, hasTVPreferredFocus, testID }: SwitchProps) {
  const reduced = useReducedMotion();
  const position = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) {
      position.setValue(value ? 1 : 0);
      return undefined;
    }
    const animation = Animated.timing(position, { toValue: value ? 1 : 0, duration: motion.durQuick, easing: Easing.bezier(...motion.easeOut), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [value, reduced, position]);

  const translateX = position.interpolate({ inputRange: [0, 1], outputRange: [0, px(travel)] });

  return (
    <FocusFrame
      testID={testID}
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value }}
      radius="radiusPill"
      contentStyle={styles.row}
    >
      <Animated.View style={[styles.track, { backgroundColor: value ? colors.text1 : colors.surface3 }]}>
        <Animated.View style={[styles.thumb, { backgroundColor: value ? colors.onLight : colors.text2, transform: [{ translateX }] }]} />
      </Animated.View>
      <Text style={[styles.words, disabled ? styles.wordsDisabled : undefined]}>{value ? "On" : "Off"}</Text>
    </FocusFrame>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: px(space.space4) },
  track: {
    width: px(sizes.switchW),
    height: px(sizes.switchH),
    borderRadius: px(radii.radiusPill),
    padding: px(pad),
    justifyContent: "center",
  },
  thumb: { width: px(sizes.switchThumb), height: px(sizes.switchThumb), borderRadius: px(radii.radiusPill) },
  words: { ...textStyle("typeLabel"), color: colors.text1 },
  wordsDisabled: { color: colors.text3 },
});
