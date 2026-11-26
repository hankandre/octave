// Dialog (DESIGN.md §7.16): a centred `surface1` panel (max `dialogMaxW`, `radiusSheet`, `shadowSheet`) over the
// `veil`: icon, title, body and actions. A `Modal`, so Back (`onRequestClose`) calls `onDismiss`, and focus is trapped
// inside the panel. `initialFocus` names the action that takes focus first, which is the safe one for risky confirms.
// `testID-fade` is the faded element, rendered only while visible; each action is `<testID>-<action id>`.
import { Animated, Modal, StyleSheet, Text, TVFocusGuideView, View } from "react-native";
import { useFade } from "../fade";
import type { IconComponent } from "../icon";
import { px } from "../scale";
import { textStyle } from "../text";
import { blackAt, colors, depth, radii, sizes, space } from "../tokens";
import { Button, type ButtonVariant } from "./button";

export type Action = { id: string; label: string; onPress: () => void; variant?: ButtonVariant; disabled?: boolean };

export type DialogProps = {
  visible: boolean;
  title: string;
  /** What the dialog is about, under the title: a name and, on its own line, an address in `typeMono`. */
  detail?: { name: string; address: string };
  message?: string;
  icon?: IconComponent;
  actions: Action[];
  /** An action `id`. Without it the last action (the primary one) takes focus first. */
  initialFocus?: string;
  onDismiss: () => void;
  testID?: string;
};

export function Dialog({ visible, title, detail, message, icon: Icon, actions, initialFocus, onDismiss, testID }: DialogProps) {
  const { show, opacity } = useFade(visible);
  if (!show) return null;
  const first = initialFocus ?? actions[actions.length - 1]?.id;
  return (
    <Modal transparent animationType="none" visible onRequestClose={onDismiss}>
      <Animated.View testID={testID ? `${testID}-fade` : undefined} style={[styles.veil, { opacity }]}>
        <TVFocusGuideView trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.panel}>
          {Icon ? <Icon size={px(sizes.emptyIcon)} color={colors.text2} /> : null}
          <Text style={styles.title}>{title}</Text>
          {detail ? (
            <View>
              <Text style={styles.name}>{detail.name}</Text>
              <Text style={styles.address}>{detail.address}</Text>
            </View>
          ) : null}
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <View style={styles.actions}>
            {actions.map((action) => (
              <Button
                key={action.id}
                testID={testID ? `${testID}-${action.id}` : undefined}
                label={action.label}
                variant={action.variant ?? "secondary"}
                onPress={action.onPress}
                disabled={action.disabled}
                hasTVPreferredFocus={action.id === first}
              />
            ))}
          </View>
        </TVFocusGuideView>
      </Animated.View>
    </Modal>
  );
}

const sheet = depth.shadowSheet;

const styles = StyleSheet.create({
  veil: { flex: 1, backgroundColor: colors.veil, alignItems: "center", justifyContent: "center" },
  panel: {
    width: "100%",
    maxWidth: px(sizes.dialogMaxW),
    padding: px(space.space7),
    gap: px(space.space5),
    borderRadius: px(radii.radiusSheet),
    backgroundColor: colors.surface1,
    boxShadow: [{ offsetX: px(sheet.offsetX), offsetY: px(sheet.offsetY), blurRadius: px(sheet.blur), spreadDistance: px(sheet.spread), color: blackAt(sheet.alpha) }],
  },
  title: { ...textStyle("typeDialogTitle"), color: colors.text1 },
  name: { ...textStyle("typeBody"), color: colors.text1 },
  address: { ...textStyle("typeMono"), color: colors.text2 },
  message: { ...textStyle("typeBody"), color: colors.text2 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: px(space.space4) },
});
