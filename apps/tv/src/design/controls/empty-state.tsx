// EmptyState (DESIGN.md §7.17): a centred column with a line icon in `text3`, a `typeHeading` title, one sentence and
// at most one action, a Button (`<testID>-action`). With no action nothing in it is focusable.
import { StyleSheet, Text, View } from "react-native";
import type { IconComponent } from "../icon";
import { px } from "../scale";
import { textStyle } from "../text";
import { colors, sizes, space } from "../tokens";
import { Button } from "./button";

export type EmptyStateProps = {
  title: string;
  message: string;
  icon?: IconComponent;
  action?: { label: string; onPress: () => void; disabled?: boolean };
  testID?: string;
};

export function EmptyState({ title, message, icon: Icon, action, testID }: EmptyStateProps) {
  return (
    <View testID={testID} style={styles.column}>
      {Icon ? <Icon size={px(sizes.emptyIcon)} color={colors.text3} /> : null}
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {action ? <Button testID={testID ? `${testID}-action` : undefined} label={action.label} variant="primary" onPress={action.onPress} disabled={action.disabled} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { flex: 1, alignItems: "center", justifyContent: "center", gap: px(space.space5) },
  title: { ...textStyle("typeHeading"), color: colors.text1, textAlign: "center" },
  message: { ...textStyle("typeBody"), color: colors.text2, textAlign: "center" },
});
