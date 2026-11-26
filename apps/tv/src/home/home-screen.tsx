// Home (T5-03, DESIGN.md §7.3, §7.4): the hero, then Continue watching, then Recently added, over the ambient backdrop.
// Nothing is drawn until the four lists settle (and, for a Series hero, its next-episode read); then both rows appear at once
// and none is added, removed or moved while Home is mounted: after a viewing, one item read gives that title's cards their
// new play state (T8-03 D8). The hero's item read arrives later and changes only its facts and overview, in slots of fixed
// height. Select on the hero or a Continue watching card hands `{ itemId, start }` to the playback
// use case and does nothing else; Home builds no media URL and calls no player method.
//
// testIDs: home-rows (the RowList) and the hero's and backdrop's own ids (hero.tsx, ambient-backdrop.tsx).
import { useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { ImageRef, ItemDetail, SeriesNextUp } from "@octave/core/src/domain/catalog";
import { loadHome, type Home } from "@octave/core/src/domain/home";
import { withViewedProgress, type ViewedItem } from "@octave/core/src/domain/home-refresh";
import { heroFacts, heroPlay, loadHeroDetail, loadHeroNext, playRequestOf } from "@octave/core/src/domain/home-hero";
import { RowList, useRowMemory, type RowListEntry, type RowSpec } from "../design/rows";
import { colors } from "../design/tokens";
import type { Route } from "../shell/routes";
import { useShell } from "../shell/shell-context";
import { AmbientBackdrop } from "./ambient-backdrop";
import { addedCard, backdropOf, continueCard } from "./home-cards";
import { HomeServicesContext, type HomeServices } from "./home-services";
import { Hero } from "./hero";

type State = { phase: "loading" } | { phase: "failed" } | { phase: "ready"; home: Home; next?: SeriesNextUp; detail?: ItemDetail };
type Action =
  | { type: "reset" }
  | { type: "failed" }
  | { type: "loaded"; home: Home; next?: SeriesNextUp }
  | { type: "detail"; detail: ItemDetail }
  | { type: "viewed"; viewed: ViewedItem };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return state.phase === "loading" ? state : { phase: "loading" };
    case "failed":
      return { phase: "failed" };
    case "loaded":
      // Set once: no card joins, leaves or moves while Home is mounted.
      if (state.phase === "ready") return state;
      return { phase: "ready", home: action.home, ...(action.next === undefined ? {} : { next: action.next }) };
    case "detail":
      if (state.phase !== "ready") return state;
      return { ...state, detail: action.detail };
    case "viewed":
      if (state.phase !== "ready") return state;
      return { ...state, home: withViewedProgress(state.home, action.viewed) };
  }
}

/** The lists, then (a Series hero) its next episode, then the hero's item read, which is allowed to arrive last. */
async function load(services: HomeServices, signal: AbortSignal, dispatch: (action: Action) => void): Promise<void> {
  const { home } = await loadHome(services.source, { window: services.window?.(), clock: services.clock }, signal);
  if (home.hero.rule === "none") {
    dispatch({ type: "loaded", home });
    return;
  }
  const card = home.hero.card;
  const detailRead = loadHeroDetail(services.source, card, signal);
  // The read may reject on abort while the next-episode read is awaited; the await below still sees it.
  detailRead.catch(() => undefined);
  const next = await loadHeroNext(services.source, card, signal);
  dispatch({ type: "loaded", home, ...(next === undefined ? {} : { next }) });
  const detail = await detailRead;
  if (detail !== undefined) dispatch({ type: "detail", detail });
}

/** The viewed title's play state as the server now holds it. A failed read leaves the cards as they were. */
function readViewed(services: HomeServices, itemId: string, signal: AbortSignal, dispatch: (action: Action) => void): void {
  services.source
    .itemDetail(itemId, signal)
    .then(({ userData, runTimeTicks }) => {
      if (!signal.aborted) dispatch({ type: "viewed", viewed: { itemId, userData, runTimeTicks } });
    })
    .catch(() => undefined);
}

export function HomeScreen(_props: { route?: Route }) {
  const services = useContext(HomeServicesContext);
  const [state, dispatch] = useReducer(reducer, { phase: "loading" });

  useEffect(() => {
    if (services === undefined) return undefined;
    const controller = new AbortController();
    // New services start a new load: the old account's rows and hero are dropped first.
    dispatch({ type: "reset" });
    // A failed load leaves a plain surface and nothing thrown; the error's text goes nowhere (T5-04 owns the copy and the retry).
    load(services, controller.signal, dispatch).catch(() => {
      if (!controller.signal.aborted) dispatch({ type: "failed" });
    });
    return () => controller.abort();
  }, [services]);

  const ready = state.phase === "ready";
  useEffect(() => {
    if (!ready) return undefined;
    const controller = new AbortController();
    const unsubscribe = services?.afterViewing?.((itemId) => readViewed(services, itemId, controller.signal, dispatch));
    return () => {
      unsubscribe?.();
      controller.abort();
    };
  }, [ready, services]);

  if (services === undefined || state.phase !== "ready") return <View style={styles.screen} />;
  return <ReadyHome services={services} home={state.home} next={state.next} detail={state.detail} />;
}

function ReadyHome({ services, home, next, detail }: { services: HomeServices; home: Home; next?: SeriesNextUp; detail?: ItemDetail }) {
  const shell = useShell();
  const memory = useRowMemory();
  const entryRef = useRef<RowListEntry | null>(null);
  const hero = home.hero.rule === "none" ? undefined : home.hero.card;
  const heroArt = hero === undefined ? undefined : backdropOf(hero);
  // The art the backdrop follows: a focused card's, or the hero's while a hero button (or nothing yet) has focus.
  const [focusedArt, setFocusedArt] = useState<{ art: ImageRef | undefined } | null>(null);
  const target = focusedArt === null ? heroArt : focusedArt.art;

  const rows = useMemo<RowSpec[]>(
    () => [
      { id: "continue-watching", title: "Continue watching", variant: "thumb", items: home.continueWatching.map(continueCard) },
      { id: "recently-added", title: "Recently added", variant: "poster", items: home.recentlyAdded.map(addedCard) },
    ],
    [home],
  );

  const cardOf = useCallback((rowId: string, index: number) => (rowId === "continue-watching" ? home.continueWatching[index] : home.recentlyAdded[index]), [home]);
  const onCardFocus = useCallback((rowId: string, index: number) => {
    const card = cardOf(rowId, index);
    setFocusedArt({ art: card === undefined ? undefined : backdropOf(card) });
  }, [cardOf]);
  const onCardPress = useCallback(
    (rowId: string, index: number) => {
      const card = cardOf(rowId, index);
      if (card === undefined) return;
      const request = rowId === "continue-watching" ? playRequestOf(card) : undefined;
      if (request !== undefined) services.play(request);
      else shell.open({ kind: "item", id: card.id });
    },
    [cardOf, services, shell],
  );

  const request = hero === undefined ? undefined : heroPlay(hero, next);
  const header =
    hero === undefined ? undefined : (
      <Hero
        title={hero.title}
        facts={heroFacts(hero, detail, next)}
        overview={detail?.overview}
        primaryLabel={request === undefined ? undefined : request.start.kind === "resume" ? "Resume" : "Play"}
        onPrimary={() => request !== undefined && services.play(request)}
        onMoreInfo={() => shell.open({ kind: "item", id: hero.id })}
        onFocusAction={() => setFocusedArt(null)}
        entryRef={entryRef}
      />
    );

  return (
    <View style={styles.screen}>
      <AmbientBackdrop target={target} />
      <RowList testID="home-rows" rows={rows} memory={memory} header={header} entryRef={entryRef} onCardFocus={onCardFocus} onCardPress={onCardPress} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
});
