// IconButton (DESIGN.md §7.19): a 64 px circle with a `fillIcon` fill. The icon comes in as a component; the control
// gives it the size and colour. `accessibilityLabel` is required because there is no visible text.
import { StyleSheet } from "react-native";
import { FocusFrame } from "../focus-frame";
import type { IconComponent } from "../icon";
import { px } from "../scale";
import { colors, radii, sizes, space } from "../tokens";

export type IconButtonProps = {
  icon: IconComponent;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  hasTVPreferredFocus?: boolean;
  testID?: string;
};

export function IconButton({ icon: Icon, accessibilityLabel, onPress, disabled = false, hasTVPreferredFocus, testID }: IconButtonProps) {
  return (
    <FocusFrame testID={testID} onPress={onPress} disabled={disabled} hasTVPreferredFocus={hasTVPreferredFocus} accessibilityRole="button" accessibilityLabel={accessibilityLabel} radius="radiusPill" contentStyle={styles.disc}>
      <Icon size={px(space.space6)} color={disabled ? colors.text3 : colors.text1} />
    </FocusFrame>
  );
}

const styles = StyleSheet.create({
  disc: {
    width: px(sizes.iconButton),
    height: px(sizes.iconButton),
    borderRadius: px(radii.radiusPill),
    backgroundColor: colors.fillIcon,
    alignItems: "center",
    justifyContent: "center",
  },
});
