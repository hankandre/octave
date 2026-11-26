// Button (DESIGN.md §7.19): primary, secondary, quiet and danger. 72 px tall, `radiusControl`, label in `typeLabel`.
// Focus ring, lift and press come from FocusFrame. A disabled button takes no focus and its label goes to `text3`.
import { StyleSheet, Text } from "react-native";
import { FocusFrame, type FocusNeighbours } from "../focus-frame";
import { px } from "../scale";
import { textStyle } from "../text";
import { colors, radii, sizes, space } from "../tokens";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export type ButtonProps = FocusNeighbours & {
  label: string;
  variant?: ButtonVariant;
  onPress: () => void;
  disabled?: boolean;
  hasTVPreferredFocus?: boolean;
  onFocus?: () => void;
  /** The button's view, for code that reports or points focus at it. */
  viewRef?: (view: unknown) => void;
  testID?: string;
};

const fill = StyleSheet.create({
  primary: { backgroundColor: colors.text1 },
  secondary: { backgroundColor: colors.fillSecondary },
  quiet: {},
  danger: { backgroundColor: colors.fillSecondary },
});

function labelColour(variant: ButtonVariant, focused: boolean, disabled: boolean): string {
  if (disabled) return colors.text3;
  switch (variant) {
    case "primary":
      return colors.onLight;
    case "secondary":
      return colors.text1;
    case "quiet":
      return focused ? colors.text1 : colors.text2;
    case "danger":
      return colors.danger;
  }
}

export function Button({ label, variant = "primary", onPress, disabled = false, hasTVPreferredFocus, onFocus, viewRef, testID, ...neighbours }: ButtonProps) {
  return (
    <FocusFrame {...neighbours} testID={testID} onPress={onPress} onFocus={onFocus} viewRef={viewRef} disabled={disabled} hasTVPreferredFocus={hasTVPreferredFocus} accessibilityRole="button" accessibilityLabel={label} contentStyle={[styles.box, fill[variant]]}>
      {({ focused }) => <Text style={[styles.label, { color: labelColour(variant, focused, disabled) }]}>{label}</Text>}
    </FocusFrame>
  );
}

const styles = StyleSheet.create({
  box: {
    minHeight: px(sizes.controlH),
    minWidth: px(sizes.hitMin),
    paddingHorizontal: px(space.space6),
    borderRadius: px(radii.radiusControl),
    alignItems: "center",
    justifyContent: "center",
  },
  label: textStyle("typeLabel"),
});
