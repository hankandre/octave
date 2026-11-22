// Toast (DESIGN.md §7.16): bottom left inside the safe inset, `surface1`, an icon and one sentence. An info toast
// takes no focus and hides after `toastMs` (it calls `onDismiss`). An error toast stays until its "Dismiss" button,
// a quiet Button, calls `onDismiss`. `<testID>-fade` is the faded element, `<testID>-dismiss` the button.
import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text } from "react-native";
import { useFade } from "../fade";
import type { IconComponent } from "../icon";
import { px } from "../scale";
import { textStyle } from "../text";
import { colors, motion, radii, sizes, space } from "../tokens";
import { Button } from "./button";

export type ToastProps = {
  visible: boolean;
  kind: "info" | "error";
  message: string;
  icon?: IconComponent;
  onDismiss: () => void;
  testID?: string;
};

export function Toast({ visible, kind, message, icon: Icon, onDismiss, testID }: ToastProps) {
  const { show, opacity } = useFade(visible);

  // Kept in a ref so an inline `onDismiss` (a new identity each render) does not restart the timer.
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    if (!visible || kind !== "info") return undefined;
    const timer = setTimeout(() => dismiss.current(), motion.toastMs);
    return () => clearTimeout(timer);
  }, [visible, kind]);

  if (!show) return null;
  return (
    <Animated.View testID={testID ? `${testID}-fade` : undefined} style={[styles.toast, { opacity }]} accessibilityLiveRegion="polite">
      {Icon ? <Icon size={px(space.space6)} color={kind === "error" ? colors.danger : colors.text2} /> : null}
      <Text style={styles.message}>{message}</Text>
      {kind === "error" ? <Button testID={testID ? `${testID}-dismiss` : undefined} label="Dismiss" variant="quiet" onPress={onDismiss} /> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: px(space.safeX),
    bottom: px(space.safeY),
    maxWidth: px(sizes.toastMaxW),
    flexDirection: "row",
    alignItems: "center",
    gap: px(space.space4),
    paddingVertical: px(space.space4),
    paddingHorizontal: px(space.space5),
    borderRadius: px(radii.radiusControl),
    backgroundColor: colors.surface1,
  },
  message: { ...textStyle("typeBody"), color: colors.text1, flexShrink: 1 },
});
