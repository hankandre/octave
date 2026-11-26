// The control row (DESIGN.md §7.14 item 3): back 10, Play or Pause on the larger disc, forward 10. Only controls that
// work are drawn; a later control joins `CONTROLS` with its command, and the row's neighbours follow from the order.
// The two 10-second labels are heard and not seen (T8-04 D7).
//
// testIDs: player-controls (the zone).
import { StyleSheet, View } from "react-native";
import { IconButton } from "../design/controls/icon-button";
import { iconOf } from "../design/icon";
import { px } from "../design/scale";
import { space } from "../design/tokens";
import type { ChromeCommand } from "./chrome-keys";
import type { Views } from "./use-views";

export const CONTROLS = ["rewind", "play", "forward"] as const;
export type ControlName = (typeof CONTROLS)[number];

function controlOf(name: ControlName, paused: boolean) {
  switch (name) {
    case "rewind":
      return { icon: iconOf("rewind-backward-10"), label: "Rewind 10 seconds", command: "seek-back" as const };
    case "play":
      return { icon: iconOf(paused ? "player-play" : "player-pause"), label: paused ? "Play" : "Pause", command: "toggle" as const };
    case "forward":
      return { icon: iconOf("rewind-forward-10"), label: "Forward 10 seconds", command: "seek-forward" as const };
  }
}

type Props = {
  views: Views<ControlName | "scrubber">;
  paused: boolean;
  focusable: boolean;
  onCommand: (command: ChromeCommand) => void;
  onFocusControl: (name: ControlName) => void;
};

export function PlayerControls({ views, paused, focusable, onCommand, onFocusControl }: Props) {
  return (
    <View testID="player-controls" style={styles.row}>
      {CONTROLS.map((name, index) => {
        const control = controlOf(name, paused);
        // The row's two ends name themselves, so focus stays in the row.
        const left = CONTROLS[index - 1] ?? name;
        const right = CONTROLS[index + 1] ?? name;
        return (
          <IconButton
            key={name}
            size={name === "play" ? "playerPlayDisc" : "iconButton"}
            icon={control.icon}
            accessibilityLabel={control.label}
            focusable={focusable}
            viewRef={views.ref(name)}
            nextFocusUp={views.tag("scrubber")}
            nextFocusDown={views.tag(name)}
            nextFocusLeft={views.tag(left)}
            nextFocusRight={views.tag(right)}
            onFocus={() => onFocusControl(name)}
            onPress={() => onCommand(control.command)}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: px(space.space6) },
});
