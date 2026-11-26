// A failed viewing's fixed copy (DESIGN.md §10). Only a player that did not stop has its action yet; the other rows'
// actions are T8-17's.
//
// testIDs: player-failure.
import { StyleSheet, Text, View } from "react-native";
import { PLAYBACK_FAILURE_COPY, type PlaybackFailureCode } from "@octave/core/src/domain/playback-failure";
import { Button } from "../design/controls/button";
import { px } from "../design/scale";
import { textStyle } from "../design/text";
import { colors, sizes, space } from "../design/tokens";
import { trapped, type Views } from "./use-views";

type Props = {
  code: PlaybackFailureCode;
  /** The copy with the server's name in it. */
  withServer: (copy: string) => string;
  views: Views<"failure">;
  onBack: () => void;
};

export function PlayerFailure({ code, withServer, views, onBack }: Props) {
  const { title = "", body, actions } = PLAYBACK_FAILURE_COPY[code];
  const [stopAction] = actions;
  return (
    <View testID="player-failure" style={[StyleSheet.absoluteFill, styles.failure]}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <Text style={styles.body}>{withServer(body)}</Text>
      {code === "stop-failed" && stopAction !== undefined ? (
        <Button label={stopAction} onPress={onBack} hasTVPreferredFocus viewRef={views.ref("failure")} {...trapped(views.tag("failure"))} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  failure: {
    alignItems: "center",
    justifyContent: "center",
    gap: px(space.space4),
    paddingHorizontal: px(space.safeX),
    paddingVertical: px(space.safeY),
    backgroundColor: colors.void,
  },
  title: { ...textStyle("typeTitle"), color: colors.text1, textAlign: "center" },
  body: { ...textStyle("typeBody"), color: colors.text2, textAlign: "center", maxWidth: px(sizes.dialogMaxW) },
});
