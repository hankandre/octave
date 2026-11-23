// Fixtures for the frozen T3-09 tests, and the props and testID contract the shell follows.
//
// Props and testID contract
// - Route (routes.ts): { kind: "home" } | { kind: "search" } | { kind: "library"; id } | { kind: "settings" } | { kind: "accounts" }
//   | { kind: "item"; id } | { kind: "play"; id } | { kind: "signIn" } | { kind: "notFound" }. Paths: /, /search, /library/<id>,
//   /settings, /accounts, /item/<id>, /play/<id>, /sign-in, /not-found. chromeOf is "none" for play and signIn, else "rail".
// - railEntries(libraries, account?) (rail-entries.ts): search, home, library:<id> per library in the given order, settings,
//   account. RailEntry = { key; label; route; icon; initial? }.
// - decideBack({ route, depth, railOpen }) (back.ts): "open-rail" | "close-rail" | "pop" | "go-home" | "exit".
// - restoreTarget(saved, rows) (focus-place.ts): saved? { rowId, itemId, index }; rows { id, items: { id }[] }[]; returns
//   { kind: "card", rowId, index } | { kind: "opening" }.
// - focus-bridge.ts: tagOf(view), focusView(view), pointGuide(guide, views). Tests replace it with focus-bridge-double.
// - SideRail (side-rail.tsx): entries, current, onSelect(entry), returnTag?, onOpenChange(open), registerEntry(key, view), testID.
// - AppShell (app-shell.tsx): screens, libraries, account?, initialPath? (default "/"), icons?.
// - useShell() (shell-context.tsx): { open(route), route }. A root route resets the stack; any other pushes.
// - useFocusPlace() (design/rows/focus-place-context.ts): { focused(key, view, card?), opening(view), rows(handle | null) }.
// - NotFoundScreen (not-found-screen.tsx): testIDs not-found and not-found-home.
//
// testIDs: rail, rail-guide, rail-entry-<key> with ":" written as "-" (rail-entry-library-A), rail-entry-<key>-label (only while
// the rail is open), rail-entry-<key>-bar (the current entry only), shell-edge, shell-content.
//
// Fixture screens: each renders a View `screen-<kind>` holding one primary Pressable `<kind>-primary` (focusable, with
// hasTVPreferredFocus), and reports it through useFocusPlace(): opening(view) when it mounts and focused("primary", view)
// when it takes focus. The Home primary opens `{ kind: "play", id: "item-1" }`. The fixture Home also renders a RowList
// (testID "l") of rows A and B, ten poster cards each (ids A-item-0 to A-item-9 and B-item-0 to B-item-9), and a card press
// opens `{ kind: "item", id: <the card's item id> }`.
//
// No literal design value appears here or in the frozen tests: sizes come from the tokens through px().
import { useCallback, useMemo, useRef, type ComponentType, type ReactElement } from "react";
import { Pressable, View } from "react-native";
import type { LibraryView } from "@octave/core/src/domain/catalog";
import { useFocusPlace } from "../../design/rows/focus-place-context";
import { RowList, type RowSpec } from "../../design/rows/row-list";
import { createRowMemory } from "../../design/rows/row-memory";
import { fixtureItems } from "../../design/rows/test-support/fixtures";
import type { Route, RouteKind } from "../routes";
import { useShell } from "../shell-context";

export const libraryA: LibraryView = { id: "A", name: "Films", collectionType: "movies" };
export const libraryB: LibraryView = { id: "B", name: "Shows", collectionType: "tvshows" };
export const libraryC: LibraryView = { id: "C", name: "Sets", collectionType: "boxsets" };

/** The server's order: A, B, C. */
export const fixtureLibraries: readonly LibraryView[] = [libraryA, libraryB, libraryC];

export const fixtureAccount = { name: "Jo" };

const CARDS = 10;

function Screen({ route }: { route: Route }): ReactElement {
  const { open } = useShell();
  const place = useFocusPlace();
  const kind = route.kind;
  const view = useRef<unknown>(null);
  const onRef = useCallback(
    (instance: unknown) => {
      view.current = instance;
      if (instance !== null) place.opening(instance);
    },
    [place],
  );
  return (
    <View testID={`screen-${kind}`}>
      <Pressable
        ref={onRef}
        testID={`${kind}-primary`}
        focusable
        hasTVPreferredFocus
        onFocus={() => place.focused("primary", view.current)}
        onPress={() => {
          if (kind === "home") open({ kind: "play", id: "item-1" });
        }}
      />
      {kind === "home" ? <HomeRows /> : null}
    </View>
  );
}

function HomeRows(): ReactElement {
  const { open } = useShell();
  const memory = useMemo(() => createRowMemory(), []);
  const rows = useMemo<RowSpec[]>(
    () => [
      { id: "A", title: "Row A", variant: "poster", items: fixtureItems("A", CARDS) },
      { id: "B", title: "Row B", variant: "poster", items: fixtureItems("B", CARDS) },
    ],
    [],
  );
  return (
    <RowList
      testID="l"
      rows={rows}
      memory={memory}
      onCardPress={(rowId, index) => {
        const item = rows.find((row) => row.id === rowId)?.items[index];
        if (item !== undefined) open({ kind: "item", id: item.id });
      }}
    />
  );
}

export const fixtureScreens: Record<Exclude<RouteKind, "notFound">, ComponentType<{ route: Route }>> = {
  home: Screen,
  search: Screen,
  library: Screen,
  settings: Screen,
  accounts: Screen,
  item: Screen,
  play: Screen,
  signIn: Screen,
};
