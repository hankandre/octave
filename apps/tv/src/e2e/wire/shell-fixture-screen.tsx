// The side rail and a button in fixed states, for the 1920×1080 captures (T3-40 item 8): the real SideRail, which
// AppShell mounts, beside the placeholder screen, with the entry focused through the views the rail registers (AppShell
// keeps those to itself). The states are the open rail with Search, Home and the last entry focused, a focused primary
// button, and a 14-library rail with the last library focused from outside the list. The last state focuses Home in
// that rail and stays long enough for the capture run to walk down to the last library with the remote's Down key.
// Fixture names only. Nothing is sent.
import type { LibraryView } from "@octave/core/src/domain/catalog";
import { useCallback, useEffect, useRef, type ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "../../design/controls";
import { px } from "../../design/scale";
import { colors, sizes, space } from "../../design/tokens";
import { FirstScreen } from "../../first-screen/FirstScreen";
import { focusView } from "../../shell/focus-bridge";
import { railEntries, type RailKey } from "../../shell/rail-entries";
import { railIcons } from "../../shell/rail-icons";
import { RailIconsProvider, SideRail } from "../../shell/side-rail";
import { wait } from "./wire-context";

// Long enough to capture each state before the next replaces it.
const STATE_HOLD_MS = 20_000;
// Long enough to press Down once per entry and capture.
const KEYS_HOLD_MS = 120_000;
// The new state has to be drawn, and its first tile to take focus, before the entry asks for it.
const SETTLE_MS = 2_000;

const library = (id: string, name: string, collectionType: string): LibraryView => ({ id, name, collectionType });

const LIBRARIES = [library("movies", "Movies", "movies"), library("shows", "Shows", "tvshows"), library("collections", "Collections", "boxsets")];
const MANY_LIBRARIES = Array.from({ length: 14 }, (_, index) => library(`${index + 1}`, `Library ${index + 1}`, "movies"));

const stay = () => undefined;

/** Focuses the view it is given once the state has settled. */
function useDelayedFocus(): (view: unknown) => void {
  const target = useRef<unknown>(null);
  useEffect(() => {
    const timer = setTimeout(() => focusView(target.current), SETTLE_MS);
    return () => clearTimeout(timer);
  }, []);
  return useCallback((view: unknown) => {
    target.current = view;
  }, []);
}

function RailFixture({ libraries, focusKey }: { libraries: readonly LibraryView[]; focusKey: RailKey }): ReactElement {
  const focusLater = useDelayedFocus();
  const registerEntry = useCallback(
    (key: RailKey, view: unknown) => {
      if (key === focusKey) focusLater(view);
    },
    [focusKey, focusLater],
  );
  return (
    <RailIconsProvider icons={railIcons}>
      <View style={styles.screen}>
        <SideRail testID="rail" entries={railEntries(libraries)} current="home" onSelect={stay} onOpenChange={stay} registerEntry={registerEntry} />
        <View style={styles.content}>
          <FirstScreen route={{ kind: "home" }} />
        </View>
      </View>
    </RailIconsProvider>
  );
}

function ButtonFixture(): ReactElement {
  const focusLater = useDelayedFocus();
  return (
    <View style={[styles.screen, styles.centred]}>
      <Button testID="fixture-button" label="Play" onPress={stay} viewRef={focusLater} />
    </View>
  );
}

const rail = (libraries: readonly LibraryView[], focusKey: RailKey) => <RailFixture libraries={libraries} focusKey={focusKey} />;

const STATES = [
  { id: "rail-search", screen: rail(LIBRARIES, "search"), holdMs: STATE_HOLD_MS },
  { id: "rail-home", screen: rail(LIBRARIES, "home"), holdMs: STATE_HOLD_MS },
  { id: "rail-last", screen: rail(LIBRARIES, "account"), holdMs: STATE_HOLD_MS },
  { id: "button", screen: <ButtonFixture />, holdMs: STATE_HOLD_MS },
  { id: "rail-overflow-last", screen: rail(MANY_LIBRARIES, "library:14"), holdMs: STATE_HOLD_MS },
  { id: "rail-overflow-dpad", screen: rail(MANY_LIBRARIES, "home"), holdMs: KEYS_HOLD_MS },
];

export async function showShellFixtures(show: (element: ReactElement | null) => Promise<void>, log: (line: string) => void): Promise<void> {
  // The last sign-in state has no hold of its own.
  await wait(STATE_HOLD_MS);
  for (const state of STATES) {
    await show(<View key={state.id} style={styles.screen}>{state.screen}</View>);
    await wait(SETTLE_MS * 2);
    log(`OCTAVE_FIXTURE shell=${state.id}`);
    await wait(state.holdMs);
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  content: { flex: 1, marginLeft: px(sizes.railCollapsedW) },
  centred: { alignItems: "center", justifyContent: "center", gap: px(space.space5) },
});
