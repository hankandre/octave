// TextField (DESIGN.md §7.19): a 72 px `surface2` field with a `lineStrong` border, the label above in `typeLabel`
// and `text2`, helper or error text below. Select focuses the native input, which opens the system keyboard.
// `testID` is the focusable frame, `<testID>-input` the native input.
import { useRef, type ComponentRef } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { FocusFrame } from "../focus-frame";
import { px } from "../scale";
import { textStyle } from "../text";
import { colors, radii, sizes, space } from "../tokens";

export type TextFieldProps = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  onFocus?: () => void;
  helper?: string;
  error?: string;
  secureTextEntry?: boolean;
  disabled?: boolean;
  hasTVPreferredFocus?: boolean;
  testID?: string;
};

export function TextField({ label, value, onChangeText, onFocus, helper, error, secureTextEntry, disabled = false, hasTVPreferredFocus, testID }: TextFieldProps) {
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  return (
    <View style={styles.column}>
      <Text style={styles.label}>{label}</Text>
      <FocusFrame
        testID={testID}
        onPress={() => input.current?.focus()}
        onFocus={onFocus}
        disabled={disabled}
        hasTVPreferredFocus={hasTVPreferredFocus}
        accessibilityLabel={label}
        contentStyle={styles.box}
      >
        <TextInput
          ref={input}
          testID={testID ? `${testID}-input` : undefined}
          focusable={false}
          editable={!disabled}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secureTextEntry}
          accessibilityLabel={label}
          style={[styles.input, disabled ? styles.inputDisabled : undefined]}
        />
      </FocusFrame>
      {error ? <Text style={[styles.note, styles.error]}>{error}</Text> : helper ? <Text style={styles.note}>{helper}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { gap: px(space.space2) },
  label: { ...textStyle("typeLabel"), color: colors.text2 },
  box: {
    minHeight: px(sizes.textFieldH),
    paddingHorizontal: px(space.space5),
    justifyContent: "center",
    borderRadius: px(radii.radiusControl),
    borderWidth: px(sizes.fieldBorderWidth),
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface2,
  },
  input: { ...textStyle("typeBody"), color: colors.text1, padding: 0 },
  inputDisabled: { color: colors.text3 },
  note: { ...textStyle("typeMeta"), color: colors.text2 },
  error: { color: colors.danger },
});
