// TextField (DESIGN.md §7.19): a 72 px `surface2` field with a `lineStrong` border, the label above in `typeLabel`
// and `text2`, helper or error text below. Select focuses the native input, which opens the system keyboard;
// the frame keeps its ring while the input has focus, even if the frame itself blurs.
// `testID` is the focusable frame, `<testID>-input` the native input.
import { useRef, useState, type ComponentRef } from "react";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { FocusFrame } from "../focus-frame";
import { px } from "../scale";
import { textStyle } from "../text";
import { colors, radii, sizes, space } from "../tokens";

export type TextFieldProps = Pick<TextInputProps, "onSubmitEditing" | "returnKeyType" | "keyboardType" | "autoCapitalize" | "autoCorrect"> & {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  onFocus?: () => void;
  helper?: string;
  error?: string;
  secureTextEntry?: boolean;
  disabled?: boolean;
  /** Shows focus with the ring alone: for a field that fills its column (DESIGN.md §9, "What lifts"). */
  still?: boolean;
  hasTVPreferredFocus?: boolean;
  /** The frame's view, for code that points focus at the field. */
  viewRef?: (view: unknown) => void;
  testID?: string;
};

export function TextField({ label, value, onChangeText, onFocus, helper, error, secureTextEntry, disabled = false, still, hasTVPreferredFocus, viewRef, testID, ...inputProps }: TextFieldProps) {
  const [inputFocused, setInputFocused] = useState(false);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  return (
    <View style={styles.column}>
      <Text style={styles.label}>{label}</Text>
      <FocusFrame
        testID={testID}
        onPress={() => input.current?.focus()}
        onFocus={onFocus}
        disabled={disabled}
        still={still}
        holdFocus={inputFocused}
        hasTVPreferredFocus={hasTVPreferredFocus}
        viewRef={viewRef}
        accessibilityLabel={label}
        contentStyle={styles.box}
      >
        <TextInput
          {...inputProps}
          ref={input}
          testID={testID ? `${testID}-input` : undefined}
          focusable={false}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
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
