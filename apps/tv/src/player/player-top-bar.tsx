// The player's top bar (DESIGN.md §7.14 item 1) over its scrim: Back, then the title block. The chrome and the loading
// layer both draw it. An episode shows the series name over "S1 · E2 {title}"; the title is the screen's one heading.
//
// testIDs: player-back, player-title-series, player-title; `testID` marks the bar itself.
import { StyleSheet, Text, View } from "react-native";
import type { ViewingTitle } from "@octave/core/src/player/viewing";
import { IconButton, type IconButtonProps } from "../design/controls/icon-button";
import { iconOf } from "../design/icon";
import { px } from "../design/scale";
import { scrimStyle } from "../design/scrim";
import { textStyle } from "../design/text";
import { colors, sizes, space } from "../design/tokens";

export type TopBarBack = Omit<IconButtonProps, "icon" | "accessibilityLabel" | "testID" | "size" | "disabled">;

function headingOf({ name, season, episode }: ViewingTitle): string {
  const numbers = [season === undefined ? undefined : `S${season}`, episode === undefined ? undefined : `E${episode}`];
  const marker = numbers.filter((part) => part !== undefined).join(" · ");
  return marker === "" ? name : `${marker} ${name}`;
}

function TitleBlock({ title }: { title: ViewingTitle }) {
  return (
    <View style={styles.titles}>
      {title.seriesName === undefined ? null : (
        <Text testID="player-title-series" numberOfLines={1} style={styles.series}>
          {title.seriesName}
        </Text>
      )}
      <Text testID="player-title" accessibilityRole="header" numberOfLines={2} style={styles.heading}>
        {headingOf(title)}
      </Text>
    </View>
  );
}

export function PlayerTopBar({ title, back, testID }: { title: ViewingTitle | undefined; back: TopBarBack; testID?: string }) {
  return (
    <View testID={testID} style={[styles.bar, scrimStyle("scrimPlayerTop", "to bottom")]}>
      <IconButton {...back} testID="player-back" icon={iconOf("arrow-left")} accessibilityLabel="Back" />
      {title === undefined ? null : <TitleBlock title={title} />}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: px(sizes.scrimPlayerTopH),
    flexDirection: "row",
    alignItems: "flex-start",
    gap: px(space.space5),
    paddingTop: px(space.safeY),
    paddingHorizontal: px(space.safeX),
  },
  titles: { flex: 1 },
  series: { ...textStyle("typeMeta"), color: colors.text2 },
  heading: { ...textStyle("typeHeading"), color: colors.text1 },
});
