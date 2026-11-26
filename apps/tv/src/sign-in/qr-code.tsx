// A QR code drawn with plain views (T4-03 D6): each row is one view per run of equal modules, dark on a light field
// with the four-module quiet zone ISO/IEC 18004 asks for. TalkBack has nothing to read in it: what it holds is on screen as text.
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { encode } from "uqr";
import { px } from "../design/scale";
import { colors } from "../design/tokens";

const QUIET_ZONE = 4;

type Run = { isDark: boolean; length: number };

function runsOf(row: readonly boolean[]): Run[] {
  const runs: Run[] = [];
  for (const isDark of row) {
    const last = runs.at(-1);
    if (last?.isDark === isDark) last.length += 1;
    else runs.push({ isDark, length: 1 });
  }
  return runs;
}

/** `size` is the widest the code may be, quiet zone included, in canvas px. */
export function QrCode({ text, size }: { text: string; size: number }) {
  const rows = useMemo(() => encode(text, { ecc: "M", border: 0 }).data.map(runsOf), [text]);
  // A whole number per module, so no module is blurred.
  const moduleSize = Math.floor(px(size) / (rows.length + 2 * QUIET_ZONE));
  return (
    <View testID="sign-in-qr" accessible={false} style={[styles.field, { padding: QUIET_ZONE * moduleSize }]}>
      {rows.map((runs, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {runs.map((run, runIndex) => (
            <View key={runIndex} style={[run.isDark ? styles.dark : styles.light, { width: run.length * moduleSize, height: moduleSize }]} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { alignSelf: "flex-start", backgroundColor: colors.text1 },
  row: { flexDirection: "row" },
  dark: { backgroundColor: colors.onLight },
  light: { backgroundColor: colors.text1 },
});
