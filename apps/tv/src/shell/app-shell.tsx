// The app shell (T3-09): one native stack holds every screen, the collapsed side rail sits beside the browse screens, and the
// shell owns Back for the whole app. Routes are built and parsed in ./routes only; screens open routes through `useShell()`.
//
// Focus: each screen reports its focus place through `useFocusPlace()` (design/rows). The rail returns focus to the last
// content element (`nextFocusRight`, select on the current entry), a thin guide at the content's left edge sends Left from a
// first column to the current entry, and Back to a screen focuses the card that opened the next one.
//
// testIDs: rail (the region), rail-guide, rail-entry-<key>, shell-edge, shell-content, not-found, not-found-home.
import { CommonActions, DarkTheme, NavigationContainer, StackActions, createNavigationContainerRef, type ParamListBase } from "@react-navigation/native";
import { createNativeStackNavigator, type NativeStackScreenProps } from "@react-navigation/native-stack";
import type { LibraryView } from "@octave/core/src/domain/catalog";
import { useCallback, useContext, createContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactElement } from "react";
import { StyleSheet, TVFocusGuideView, View } from "react-native";
import { LeftEdgeContext, FocusPlaceContext } from "../design/rows";
import { px } from "../design/scale";
import { colors, sizes, space } from "../design/tokens";
import { createFocusPlaces, restoreTarget, type FocusPlaces, type Place } from "./focus-place";
import { focusView, pointGuide, tagOf } from "./focus-bridge";
import { NotFoundScreen } from "./not-found-screen";
import { railEntries, type RailEntry, type RailKey } from "./rail-entries";
import { chromeOf, fromScreen, parsePath, railKeyOf, toScreen, type Route, type RouteKind } from "./routes";
import { ShellContext, type ShellApi } from "./shell-context";
import { RailIconsProvider, SideRail, type RailIcons } from "./side-rail";
import { useShellBack } from "./use-shell-back";

export type AppShellProps = {
  screens: Record<Exclude<RouteKind, "notFound">, ComponentType<{ route: Route }>>;
  libraries: readonly LibraryView[];
  account?: { name: string };
  /** The path the app opens at; an unknown one shows the not-found state. */
  initialPath?: string;
  icons?: RailIcons;
};

type Internals = {
  places: FocusPlaces;
  screens: () => AppShellProps["screens"];
  restore(routeKey: string): void;
};

const InternalsContext = createContext<Internals | null>(null);

const Stack = createNativeStackNavigator();
const KINDS: RouteKind[] = ["home", "search", "library", "settings", "accounts", "item", "play", "signIn", "notFound"];
const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: colors.surface0 } };

type ScreenProps = NativeStackScreenProps<Record<string, { id?: string } | undefined>>;

/** What each stack screen renders: the route's screen under its own focus reporter, and the restore on return. */
function ScreenHost({ route: stackRoute, navigation }: ScreenProps): ReactElement {
  const internals = useContext(InternalsContext);
  const routeKey = stackRoute.key;
  const route = fromScreen(stackRoute.name, stackRoute.params);
  const left = useRef(false);

  useEffect(() => {
    const unblur = navigation.addListener("blur", () => {
      left.current = true;
    });
    const unfocus = navigation.addListener("focus", () => {
      if (!left.current) return;
      left.current = false;
      internals?.restore(routeKey);
    });
    return () => {
      unblur();
      unfocus();
    };
  }, [navigation, internals, routeKey]);

  useEffect(() => () => internals?.places.drop(routeKey), [internals, routeKey]);

  if (internals === null) return <View />;
  const reporter = internals.places.reporterFor(routeKey);
  const Screen = route.kind === "notFound" ? NotFoundScreen : internals.screens()[route.kind];
  return (
    <FocusPlaceContext.Provider value={reporter}>
      <Screen route={route} />
    </FocusPlaceContext.Provider>
  );
}

export function AppShell({ screens, libraries, account, initialPath = "/", icons }: AppShellProps): ReactElement {
  const initial = useMemo(() => parsePath(initialPath), [initialPath]);
  const nav = useMemo(() => createNavigationContainerRef<ParamListBase>(), []);
  const places = useMemo(() => createFocusPlaces(), []);
  const [top, setTop] = useState<Route>(initial);
  const [currentKey, setCurrentKey] = useState<RailKey>(railKeyOf(initial) ?? "home");
  const [returnTag, setReturnTag] = useState<number | undefined>(undefined);
  const entries = useMemo(() => railEntries(libraries, account), [libraries, account]);
  const topKey = useRef<string | undefined>(undefined);
  const railOpen = useRef(false);
  const entryViews = useRef(new Map<RailKey, unknown>());
  const edge = useRef<unknown>(null);
  const chrome = chromeOf(top);

  const sync = useCallback(() => {
    const current = nav.isReady() ? nav.getCurrentRoute() : undefined;
    if (current === undefined) return;
    // A new top screen is a new view tree: the old screen's tag is dead, so the rail's way back starts empty until the rail opens again.
    if (topKey.current !== current.key) setReturnTag(undefined);
    topKey.current = current.key;
    const route = fromScreen(current.name, current.params);
    setTop(route);
    const key = railKeyOf(route);
    if (key !== undefined) setCurrentKey(key);
  }, [nav]);

  const open = useCallback(
    (route: Route) => {
      if (!nav.isReady()) return;
      const screen = toScreen(route);
      const root = railKeyOf(route) !== undefined;
      nav.dispatch(root ? CommonActions.reset({ index: 0, routes: [{ name: screen.name, params: screen.params }] }) : StackActions.push(screen.name, screen.params));
    },
    [nav],
  );
  // The same pop Back runs on a pushed screen (use-shell-back.ts); the bottom screen has nothing to close.
  const close = useCallback(() => {
    if (nav.isReady() && nav.canGoBack()) nav.dispatch(StackActions.pop());
  }, [nav]);
  const api = useMemo<ShellApi>(() => ({ open, close, route: top }), [open, close, top]);

  const placeOfTop = useCallback((): Place | undefined => (topKey.current === undefined ? undefined : places.get(topKey.current)), [places]);

  const restore = useCallback(
    (routeKey: string) => {
      const place = places.get(routeKey);
      if (place === undefined) return;
      const rows = place.rows?.rows() ?? [];
      const target = restoreTarget(place.card, rows);
      if (target.kind === "card") {
        const itemId = rows.find((row) => row.id === target.rowId)?.items[target.index]?.id;
        const view = itemId === undefined ? undefined : place.rows?.viewOf(target.rowId, itemId);
        if (view !== undefined && view !== null) {
          focusView(view);
          return;
        }
      }
      focusView(place.card === undefined && place.view !== undefined ? place.view : place.opening);
    },
    [places],
  );
  // `screens` is read through a ref so a caller's inline object never rebuilds `internals`, which would drop every saved focus place.
  const screensRef = useRef(screens);
  screensRef.current = screens;
  const internals = useMemo<Internals>(() => ({ places, screens: () => screensRef.current, restore }), [places, restore]);

  const onOpenChange = useCallback(
    (isOpen: boolean) => {
      railOpen.current = isOpen;
      if (!isOpen) return;
      const place = placeOfTop();
      place?.rows?.clear();
      setReturnTag(place?.view === undefined ? undefined : tagOf(place.view));
    },
    [placeOfTop],
  );
  const registerEntry = useCallback((key: RailKey, view: unknown) => {
    if (view === null || view === undefined) entryViews.current.delete(key);
    else entryViews.current.set(key, view);
  }, []);
  const onSelect = useCallback(
    (entry: RailEntry) => {
      if (entry.key !== currentKey) {
        open(entry.route);
        return;
      }
      const place = placeOfTop();
      focusView(place?.view ?? place?.opening);
    },
    [currentKey, open, placeOfTop],
  );

  useShellBack({
    nav,
    onOpenRail: () => focusView(entryViews.current.get(currentKey)),
    onCloseRail: () => {
      const place = placeOfTop();
      focusView(place?.view ?? place?.opening);
    },
    railOpen,
  });

  // The edge guide sends Left from a first column to the current entry.
  useEffect(() => {
    if (chrome !== "rail") return;
    const view = entryViews.current.get(currentKey);
    pointGuide(edge.current, view === undefined ? [] : [view]);
  }, [chrome, currentKey, entries]);

  const initialState = useMemo(() => {
    const screen = toScreen(initial);
    return { index: 0, routes: [{ name: screen.name, params: screen.params }] };
  }, [initial]);

  return (
    <ShellContext.Provider value={api}>
      <RailIconsProvider icons={icons}>
        <View style={styles.root}>
          {chrome === "rail" ? (
            <SideRail testID="rail" entries={entries} current={currentKey} onSelect={onSelect} returnTag={returnTag} onOpenChange={onOpenChange} registerEntry={registerEntry} />
          ) : null}
          <View testID="shell-content" style={[styles.content, chrome === "rail" ? { marginLeft: px(sizes.railCollapsedW) } : undefined]}>
            {chrome === "rail" ? <TVFocusGuideView {...{ ref: edge }} testID="shell-edge" style={styles.edge} /> : null}
            <LeftEdgeContext.Provider value={chrome === "rail" ? "open" : "trap"}>
              <InternalsContext.Provider value={internals}>
                <NavigationContainer ref={nav} theme={theme} initialState={initialState} onReady={sync} onStateChange={sync}>
                  <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface0 } }}>
                    {KINDS.map((kind) => (
                      <Stack.Screen key={kind} name={kind}>
                        {(props) => <ScreenHost {...(props as ScreenProps)} />}
                      </Stack.Screen>
                    ))}
                  </Stack.Navigator>
                </NavigationContainer>
              </InternalsContext.Provider>
            </LeftEdgeContext.Provider>
          </View>
        </View>
      </RailIconsProvider>
    </ShellContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface0 },
  content: { flex: 1 },
  edge: { position: "absolute", top: 0, bottom: 0, left: 0, width: px(space.space1) },
});
