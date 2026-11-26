// The server rows (DESIGN.md §7.20): remembered servers first, then "On this network" over the found ones.
import { Fragment } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ServerRow as ServerRowData } from "@octave/core/src/domain/server-choice";
import { px } from "../design/scale";
import { textStyle } from "../design/text";
import { colors, space } from "../design/tokens";
import { rowControl, type ControlId } from "./controls";
import { ServerRow } from "./server-row";

type Props = {
  rows: readonly ServerRowData[];
  preferred: ControlId;
  register: (control: ControlId) => (view: unknown) => void;
  onChoose: (row: ServerRowData) => void;
};

export function ServerList({ rows, preferred, register, onChoose }: Props) {
  const firstFound = rows.findIndex((row) => row.kind === "found");
  return (
    <View style={styles.list}>
      {rows.map((row, index) => {
        const control = rowControl(row);
        return (
          <Fragment key={control}>
            {index === firstFound ? <Text style={styles.section}>On this network</Text> : null}
            <ServerRow
              testID={`server-row-${index}`}
              row={row}
              hasTVPreferredFocus={preferred === control}
              viewRef={register(control)}
              onPress={() => onChoose(row)}
            />
          </Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: px(space.space4) },
  section: { ...textStyle("typeHeading"), color: colors.text1 },
});
