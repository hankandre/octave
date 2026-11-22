// Notice (DESIGN.md §7.16): a full-screen state on `surface0`: the item title, the notice title, the explanation,
// "What you can do" and the actions, which are Buttons (`<testID>-<action id>`). The item's backdrop under the scrims
// waits for the native image view (T3-11). The first action is primary, the rest secondary, unless they say otherwise.
import { StyleSheet, Text, View } from "react-native";
import type { IconComponent } from "../icon";
import { px } from "../scale";
import { textStyle } from "../text";
import { colors, sizes, space } from "../tokens";
import { Button } from "./button";
import type { Action } from "./dialog";

export type NoticeProps = {
  title: string;
  message: string;
  itemTitle?: string;
  icon?: IconComponent;
  actions: Action[];
  testID?: string;
};

export function Notice({ title, message, itemTitle, icon: Icon, actions, testID }: NoticeProps) {
  return (
    <View testID={testID} style={styles.screen}>
      {itemTitle ? <Text style={styles.item}>{itemTitle}</Text> : null}
      {Icon ? <Icon size={px(sizes.emptyIcon)} color={colors.notice} /> : null}
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <Text style={styles.message}>{message}</Text>
      {actions.length > 0 ? (
        <>
          <Text style={styles.hint}>What you can do</Text>
          <View style={styles.actions}>
            {actions.map((action, index) => (
              <Button
                key={action.id}
                testID={testID ? `${testID}-${action.id}` : undefined}
                label={action.label}
                variant={action.variant ?? (index === 0 ? "primary" : "secondary")}
                onPress={action.onPress}
                disabled={action.disabled}
                hasTVPreferredFocus={index === 0}
              />
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "center",
    gap: px(space.space4),
    paddingHorizontal: px(space.safeX),
    paddingVertical: px(space.safeY),
    backgroundColor: colors.surface0,
  },
  item: { ...textStyle("typeMeta"), color: colors.text2 },
  title: { ...textStyle("typeTitle"), color: colors.text1 },
  message: { ...textStyle("typeBody"), color: colors.text2 },
  hint: { ...textStyle("typeLabel"), color: colors.text2, marginTop: px(space.space5) },
  actions: { flexDirection: "row", gap: px(space.space4) },
});
