// The launch screen for a stored sign-in that could not be checked (T4-05 D7, Q12; DESIGN.md §7.20): the sign-in row's
// sentence for the failure, then "Try again" (primary, focused) and "Change server" (quiet, last). It holds no new
// words. The caller handles Back, which leaves the app.
//
// testIDs: restore-unavailable, restore-unavailable-sentence, restore-try-again, restore-change-server.
import { StyleSheet, Text, View } from "react-native";
import type { ServerChoiceFailure } from "@octave/core/src/domain/server-choice";
import { Button } from "../design/controls/button";
import { px } from "../design/scale";
import { textStyle } from "../design/text";
import { colors, space } from "../design/tokens";
import { CHANGE_SERVER_LABEL, QUICK_CONNECT_COPY, signInSentence } from "./sign-in-copy";

type Props = {
  address: string;
  failure: ServerChoiceFailure;
  onTryAgain(): void;
  onChangeServer(): void;
};

export function RestoreUnavailable({ address, failure, onTryAgain, onChangeServer }: Props) {
  return (
    <View testID="restore-unavailable" style={styles.screen}>
      <Text testID="restore-unavailable-sentence" accessibilityRole="header" style={styles.sentence}>
        {signInSentence(failure, address)}
      </Text>
      <View style={styles.button}>
        <Button testID="restore-try-again" label={QUICK_CONNECT_COPY.tryAgain} onPress={onTryAgain} hasTVPreferredFocus />
      </View>
      <View style={styles.button}>
        <Button testID="restore-change-server" label={CHANGE_SERVER_LABEL} variant="quiet" onPress={onChangeServer} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: px(space.safeX), paddingVertical: px(space.safeY), gap: px(space.space5) },
  sentence: { ...textStyle("typeBody"), color: colors.text1 },
  button: { alignSelf: "flex-start" },
});
