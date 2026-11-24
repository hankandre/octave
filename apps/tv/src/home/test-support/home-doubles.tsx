// Doubles for the T5-03 Home tests (frozen with T5-03).
//
// Testing contract of the Home screen (the implementer builds to it)
// - `HomeScreen` (home-screen.tsx, re-exported by ../index) takes `{ route }` like every shell screen and reads its inputs from
//   `HomeServicesContext` (home-services.tsx). It draws nothing before the lists settle.
// - testIDs: home-rows (the RowList's testID, so home-rows-list and home-rows-row-<rowId>[-card-<n>[-title]]) with the row ids
//   continue-watching and recently-added; home-hero-title, home-hero-facts (Text), home-hero-facts-slot (fixed height),
//   home-hero-overview (Text), home-hero-overview-slot (fixed height), home-hero-primary and home-hero-more-info (the
//   two buttons), home-hero-primary-slot and home-hero-more-info-slot (the View around each button that carries onLayout, with
//   its frame relative to the action bar); home-backdrop (the layer) and home-backdrop-artwork* (the artwork slot of each layer
//   drawn, the newest last).
// - The artwork slot gets the props of design/rows/artwork.tsx; `FakeArtwork` renders a View carrying the `image` it got.
import { jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { View } from "react-native";
import type { ImageRef, ItemDetail, MediaCard, SeriesNextUp } from "@octave/core/src/domain/catalog";
import type { HeroSource, PlayRequest } from "@octave/core/src/domain/home-hero";
import type { HomeSource } from "@octave/core/src/domain/home";
import type { RecentPlays } from "@octave/core/src/domain/up-next";
import { ArtworkProvider } from "../../design/rows/artwork";
import { FocusPlaceContext } from "../../design/rows/focus-place-context";
import { ReducedMotionProvider } from "../../design/motion";
import { pressSelect } from "../../design/test-support/select-key";
import { ShellContext } from "../../shell/shell-context";
import { HomeScreen, HomeServicesContext, type HomeServices } from "../index";

export const MINUTE = 600_000_000;
export const NOW = Date.parse("2026-06-20T12:00:00Z");
const DAY = 86_400_000;
export const ago = (days: number): string => new Date(NOW - days * DAY).toISOString();

export function art(itemId: string, type: ImageRef["type"], tag?: string): ImageRef {
  return { itemId, type, tag: tag ?? `${itemId}-${type.toLowerCase()}` };
}

export function movie(id: string, extra: Partial<MediaCard> = {}): MediaCard {
  return { id, kind: "Movie", title: `Title ${id}`, subtitle: "2021", image: art(id, "Primary"), aspectRatio: 2 / 3, ...extra };
}

export function episode(id: string, extra: Partial<MediaCard> = {}): MediaCard {
  return { id, kind: "Episode", title: `Show of ${id}`, image: art(id, "Primary"), aspectRatio: 16 / 9, ...extra };
}

export function series(id: string, extra: Partial<MediaCard> = {}): MediaCard {
  return { id, kind: "Series", title: `Series ${id}`, image: art(id, "Primary"), aspectRatio: 2 / 3, ...extra };
}

/** The hero of the default lists: the newest play, a film part-watched. */
export const heroFilm = movie("hero-film", {
  title: "Harbor Lights",
  subtitle: "2023",
  resumePositionTicks: 90 * MINUTE,
  progress: 0.5,
  remainingTicks: 33 * MINUTE,
  lastPlayedAt: ago(1),
  backdrop: art("hero-film", "Backdrop", "hero-bd"),
});

/** Continue watching card 0 under the default hero. */
export const cwEpisode = episode("ep-2", {
  title: "Quiet Coast",
  subtitle: "S1 · E2 · The Keeper's Log",
  seasonNumber: 1,
  episodeNumber: 2,
  seriesId: "series-q",
  resumePositionTicks: 20 * MINUTE,
  progress: 0.4,
  remainingTicks: 38 * MINUTE,
  lastPlayedAt: ago(2),
  thumb: art("ep-2", "Thumb"),
  backdrop: art("ep-2", "Backdrop", "ep2-bd"),
});

/** Continue watching card 1: a film with a position and no backdrop of any kind. */
export const cwFilm = movie("film-4", {
  title: "Salt Road",
  resumePositionTicks: 30 * MINUTE,
  progress: 0.3,
  remainingTicks: 61 * MINUTE,
  lastPlayedAt: ago(3),
  thumb: art("film-4", "Thumb"),
});

/** Continue watching card 2: the next episode of a show, so no saved position. */
export const nextEpisode = episode("next-ep", {
  title: "Tide Table",
  subtitle: "S2 · E1 · Low Water",
  seasonNumber: 2,
  episodeNumber: 1,
  seriesId: "series-n",
  thumb: art("next-ep", "Thumb"),
  backdrop: art("next-ep", "Backdrop", "nx-bd"),
});

const cwFillers = [5, 6, 7, 8].map((n) =>
  movie(`cw-${n}`, { resumePositionTicks: n * MINUTE, progress: 0.2, remainingTicks: 80 * MINUTE, lastPlayedAt: ago(10 + n), thumb: art(`cw-${n}`, "Thumb") }),
);

/** Recently added card 0 and 1: a film, and a show (the series, as a grouped answer gives it). */
export const newMovie = movie("movie-new", { title: "Newcomer", subtitle: "2025" });
export const newSeries = series("series-new", { title: "Brand Show", subtitle: "2025" });

const newFillers = [2, 3, 4, 5, 6, 7, 8, 9].map((n) => movie(`new-${n}`));

export type Answers = {
  resume?: MediaCard[] | Promise<MediaCard[]>;
  nextUp?: MediaCard[] | Promise<MediaCard[]>;
  recentlyPlayed?: RecentPlays | Promise<RecentPlays>;
  latest?: MediaCard[] | Promise<MediaCard[]>;
  itemDetail?: (id: string) => Promise<ItemDetail>;
  seriesNextUp?: (id: string) => Promise<SeriesNextUp | undefined>;
};

export function defaultLists(): { resume: MediaCard[]; nextUp: MediaCard[]; recentlyPlayed: RecentPlays; latest: MediaCard[] } {
  return {
    resume: [heroFilm, cwEpisode, cwFilm, ...cwFillers],
    nextUp: [nextEpisode],
    recentlyPlayed: { entries: [{ id: "done-1", kind: "Episode", seriesId: "series-n", playedAt: ago(4) }], complete: true },
    latest: [newMovie, newSeries, ...newFillers],
  };
}

/** The item read of the default hero: 2 h 3 min, 4K, Dolby Vision, with an overview. */
export function detailOf(id: string, over: Partial<ItemDetail> = {}): ItemDetail {
  return {
    id,
    type: "Movie",
    title: "Harbor Lights",
    year: 2023,
    runTimeTicks: 123 * MINUTE,
    overview: "A keeper tends the last light on a coast the charts forgot.",
    genres: [],
    cast: [],
    userData: { played: false, favorite: false, resumePositionTicks: 0 },
    versions: [{ id: "v1", name: "4K", audio: [], subtitles: [], video: { width: 3840, height: 2160, hdr: "Dolby Vision" } }],
    ...over,
  };
}

export type Source = HomeSource & HeroSource;

export function fakeSource(answers: Answers = {}) {
  const lists = defaultLists();
  const source = {
    resumeItems: jest.fn(async (_signal?: AbortSignal, _limit?: number) => await (answers.resume ?? lists.resume)),
    nextUp: jest.fn(async (_signal?: AbortSignal, _limit?: number) => await (answers.nextUp ?? lists.nextUp)),
    recentlyPlayed: jest.fn(async (_signal?: AbortSignal) => await (answers.recentlyPlayed ?? lists.recentlyPlayed)),
    latestItems: jest.fn(async (_signal?: AbortSignal) => await (answers.latest ?? lists.latest)),
    itemDetail: jest.fn(async (id: string, _signal?: AbortSignal) => (answers.itemDetail ? await answers.itemDetail(id) : detailOf(id))),
    seriesNextUp: jest.fn(async (id: string, _signal?: AbortSignal) => (answers.seriesNextUp ? await answers.seriesNextUp(id) : undefined)),
  };
  return source satisfies Source;
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export type Rig = {
  services: HomeServices;
  source: ReturnType<typeof fakeSource>;
  play: jest.Mock<(request: PlayRequest) => void>;
  open: jest.Mock<(route: unknown) => void>;
  reporter: { focused: jest.Mock; opening: jest.Mock; rows: jest.Mock };
};

export function makeRig(answers: Answers = {}, over: Partial<HomeServices> = {}): Rig {
  const source = fakeSource(answers);
  const play = jest.fn<(request: PlayRequest) => void>();
  const services: HomeServices = { source, clock: { now: () => NOW }, play, ...over };
  return { services, source, play, open: jest.fn(), reporter: { focused: jest.fn(), opening: jest.fn(), rows: jest.fn() } };
}

/** A test ArtworkComponent: a View under the testID it got, carrying the image, so a test reads which picture a slot draws. */
export function FakeArtwork(props: { image: ImageRef; width: number; height: number; onFailed: () => void; testID?: string }): ReactElement {
  return <View testID={props.testID} {...({ image: props.image } as object)} />;
}

/** Lets the settled promises of a load reach the screen. */
export async function flush(rounds = 12): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

export async function renderHome(rig: Rig, options: { reduced?: boolean; services?: boolean } = {}) {
  const home = <HomeScreen route={{ kind: "home" }} />;
  const view = await render(
    <ReducedMotionProvider value={options.reduced ?? false}>
      <ShellContext.Provider value={{ open: rig.open as never, route: { kind: "home" } }}>
        <FocusPlaceContext.Provider value={rig.reporter}>
          <ArtworkProvider component={FakeArtwork}>
            {options.services === false ? home : <HomeServicesContext.Provider value={rig.services}>{home}</HomeServicesContext.Provider>}
          </ArtworkProvider>
        </FocusPlaceContext.Provider>
      </ShellContext.Provider>
    </ReducedMotionProvider>,
  );
  await flush();
  return view;
}

export const focusEvent = { nativeEvent: {} };

export async function focusOn(testID: string): Promise<void> {
  await fireEvent(screen.getByTestId(testID), "focus", focusEvent);
}

export async function press(testID: string): Promise<void> {
  await pressSelect(screen.getByTestId(testID));
}

export const rowCard = (rowId: "continue-watching" | "recently-added", index: number): string => `home-rows-row-${rowId}-card-${index}`;

/** The rows shown, by id, in the order they render. */
export function shownRows(): string[] {
  return screen.queryAllByTestId(/^home-rows-row-(continue-watching|recently-added)$/).map((element) => String(element.props.testID).replace("home-rows-row-", ""));
}

/** The accessibility label of every card of both rows, in tree order: it names the title, so it follows the order shown. */
export function cardLabels(): string[] {
  return screen.queryAllByTestId(/^home-rows-row-[a-z-]+-card-\d+$/).map((element) => String(element.props.accessibilityLabel));
}

export const textOf = (testID: string): string => [screen.getByTestId(testID).props.children].flat(Infinity).join("");

/** The testIDs of every element that asks for the preferred focus. */
export const preferredFocus = (): unknown[] => screen.container.queryAll((instance) => Boolean(instance.props.hasTVPreferredFocus)).map((instance) => instance.props.testID);

export function layoutEvent(x: number, width: number) {
  return { nativeEvent: { layout: { x, y: 0, width, height: 72 } } };
}

export const MORE_INFO_LABEL = "More info";
