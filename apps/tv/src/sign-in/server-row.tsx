// One server on the first sign-in step (DESIGN.md §7.20): its name and address, and for a found one who advertised it
// and any conflict. Select chooses it.
import { StyleSheet, Text } from "react-native";
import type { ServerRow as ServerRowData } from "@octave/core/src/domain/server-choice";
import { FocusFrame } from "../design/focus-frame";
import { px } from "../design/scale";
import { textStyle } from "../design/text";
import { colors, radii, sizes, space } from "../design/tokens";
import { CONFLICT_LINE } from "./sign-in-copy";

type Props = {
  row: ServerRowData;
  onPress: () => void;
  hasTVPreferredFocus: boolean;
  viewRef: (view: unknown) => void;
  testID: string;
};

export function ServerRow({ row, onPress, hasTVPreferredFocus, viewRef, testID }: Props) {
  const advertised = row.kind === "found" ? `Advertised by ${row.advertisedBy}` : undefined;
  const conflict = row.kind === "found" && row.conflicting ? CONFLICT_LINE : undefined;
  const label = [row.name, row.address, advertised, conflict].filter((part) => part !== undefined).join(", ");
  return (
    <FocusFrame
      testID={testID}
      onPress={onPress}
      hasTVPreferredFocus={hasTVPreferredFocus}
      viewRef={viewRef}
      accessibilityRole="button"
      accessibilityLabel={label}
      contentStyle={styles.box}
    >
      <Text style={styles.name}>{row.name}</Text>
      <Text style={styles.address}>{row.address}</Text>
      {advertised === undefined ? null : <Text style={styles.advertised}>{advertised}</Text>}
      {conflict === undefined ? null : <Text style={styles.conflict}>{conflict}</Text>}
    </FocusFrame>
  );
}

const styles = StyleSheet.create({
  box: {
    minHeight: px(sizes.controlH),
    paddingHorizontal: px(space.space5),
    paddingVertical: px(space.space4),
    borderRadius: px(radii.radiusControl),
    backgroundColor: colors.surface2,
  },
  name: { ...textStyle("typeLabel"), color: colors.text1 },
  address: { ...textStyle("typeMono"), color: colors.text2 },
  advertised: { ...textStyle("typeMeta"), color: colors.text2 },
  conflict: { ...textStyle("typeMeta"), color: colors.danger },
});
