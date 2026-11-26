// The password step's slot until T4-04 (T4-03 D7). It says only that the step is not built, and offers the way back.
import { StyleSheet, Text, View } from "react-native";
import { Button } from "../design/controls/button";
import { textStyle } from "../design/text";
import { colors } from "../design/tokens";
import { CHANGE_SERVER_LABEL, PASSWORD_PENDING_COPY } from "./sign-in-copy";
import type { PasswordStepProps } from "./sign-in-services";
import { SignInStepFrame } from "./sign-in-step-frame";

export function PasswordPending({ changeServer }: PasswordStepProps) {
  return (
    <SignInStepFrame heading={PASSWORD_PENDING_COPY.heading}>
      <Text style={styles.body}>{PASSWORD_PENDING_COPY.body}</Text>
      <View style={styles.button}>
        <Button testID="sign-in-change-server" label={CHANGE_SERVER_LABEL} variant="quiet" onPress={changeServer} hasTVPreferredFocus />
      </View>
    </SignInStepFrame>
  );
}

const styles = StyleSheet.create({
  body: { ...textStyle("typeBody"), color: colors.text1 },
  button: { alignSelf: "flex-start" },
});
