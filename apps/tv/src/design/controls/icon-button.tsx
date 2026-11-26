// IconButton (DESIGN.md §7.19): a 64 px circle with a `fillIcon` fill; the player's Play or Pause is the larger disc.
// The icon comes in as a component; the control gives it the size and colour. `accessibilityLabel` is required because
// there is no visible text.
import { StyleSheet } from "react-native";
import { FocusFrame, type FocusFrameProps, type FocusNeighbours } from "../focus-frame";
import type { IconComponent } from "../icon";
import { px } from "../scale";
import { colors, radii, sizes, space } from "../tokens";

export type IconButtonProps = FocusNeighbours & Pick<FocusFrameProps, "viewRef" | "focusable" | "onFocus"> & {
  /** A `sizes` key: the disc's diameter. */
  size?: "iconButton" | "playerPlayDisc";
  icon: IconComponent;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  hasTVPreferredFocus?: boolean;
  testID?: string;
};

export function IconButton({ icon: Icon, size = "iconButton", disabled = false, ...frame }: IconButtonProps) {
  return (
    <FocusFrame {...frame} disabled={disabled} accessibilityRole="button" radius="radiusPill" contentStyle={[styles.disc, discSize[size]]}>
      <Icon size={px(space.space6)} color={disabled ? colors.text3 : colors.text1} />
    </FocusFrame>
  );
}

const discSize = StyleSheet.create({
  iconButton: { width: px(sizes.iconButton), height: px(sizes.iconButton) },
  playerPlayDisc: { width: px(sizes.playerPlayDisc), height: px(sizes.playerPlayDisc) },
});

const styles = StyleSheet.create({
  disc: {
    borderRadius: px(radii.radiusPill),
    backgroundColor: colors.fillIcon,
    alignItems: "center",
    justifyContent: "center",
  },
});
