// The frame of every sign-in step (T4-02 D8): the heading and, once a server is chosen, its exact address under it.
import { useContext, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { px } from "../design/scale";
import { textStyle } from "../design/text";
import { colors, radii, space } from "../design/tokens";
import { ChosenServerContext } from "./sign-in-services";

export function SignInStepFrame({ heading, children }: { heading: string; children: ReactNode }) {
  const chosen = useContext(ChosenServerContext);
  return (
    <View style={styles.frame}>
      <Text accessibilityRole="header" style={styles.heading}>
        {heading}
      </Text>
      {chosen === undefined ? null : (
        <View testID="sign-in-origin-chip" accessible accessibilityLabel={`Server ${chosen.address}`} style={styles.chip}>
          <Text style={styles.origin}>{chosen.address}</Text>
        </View>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, paddingHorizontal: px(space.safeX), paddingVertical: px(space.safeY), gap: px(space.space5) },
  heading: { ...textStyle("typeTitle"), color: colors.text1 },
  chip: {
    alignSelf: "flex-start",
    paddingHorizontal: px(space.space5),
    paddingVertical: px(space.space2),
    borderRadius: px(radii.radiusPill),
    backgroundColor: colors.surface2,
  },
  origin: { ...textStyle("typeMono"), color: colors.text1 },
});
