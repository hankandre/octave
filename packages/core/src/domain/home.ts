import type { MediaCard } from "./catalog";
import { continueWatchingRow, pickUpNext, type ContinueWindow, type RecentPlays, type UpNext } from "./up-next";

// Home's lists, and the three things they make: Continue watching, Recently added and the hero (T5-02).
// Pure: the window and the clock are arguments, and a server is reached only through HomeSource.

export type HomeListName = "resume" | "nextUp" | "recentlyPlayed" | "recentlyAdded";

// A list that is absent failed or was not asked for.
export interface HomeLists {
  resume?: MediaCard[];
  nextUp?: MediaCard[];
  recentlyPlayed?: RecentPlays;
  recentlyAdded?: MediaCard[];
}

export interface HomeListFailure {
  list: HomeListName;
  // What the gateway raised: already redacted. The app maps it to plain copy and never shows it.
  error: unknown;
}

// The four reads Home needs. JellyfinGateway satisfies it structurally.
export interface HomeSource {
  resumeItems(signal?: AbortSignal): Promise<MediaCard[]>;
  nextUp(signal?: AbortSignal): Promise<MediaCard[]>;
  recentlyPlayed(signal?: AbortSignal): Promise<RecentPlays>;
  latestItems(signal?: AbortSignal): Promise<MediaCard[]>;
}

export const HOME_LISTS: readonly HomeListName[] = ["resume", "nextUp", "recentlyPlayed", "recentlyAdded"];

const READ: Record<HomeListName, (source: HomeSource, signal?: AbortSignal) => Promise<MediaCard[] | RecentPlays>> = {
  resume: (source, signal) => source.resumeItems(signal),
  nextUp: (source, signal) => source.nextUp(signal),
  recentlyPlayed: (source, signal) => source.recentlyPlayed(signal),
  recentlyAdded: (source, signal) => source.latestItems(signal),
};

// Starts every named list at once. A list that fails is named in `failed`, in the order of `names`, and the rest
// arrive (D7). An aborted signal rejects the whole load.
export async function loadHomeLists(
  source: HomeSource,
  names: readonly HomeListName[],
  signal?: AbortSignal,
): Promise<{ lists: HomeLists; failed: HomeListFailure[] }> {
  const settled = await Promise.allSettled(names.map((name) => READ[name](source, signal)));
  // The host types of the core do not declare `reason`.
  if (signal?.aborted) throw (signal as { reason?: unknown }).reason;
  const lists: Record<string, unknown> = {};
  const failed: HomeListFailure[] = [];
  settled.forEach((result, index) => {
    const list = names[index]!;
    if (result.status === "fulfilled") lists[list] = result.value;
    else failed.push({ list, error: result.reason });
  });
  return { lists: lists as HomeLists, failed };
}

export interface Home {
  hero: UpNext;
  // Without the hero.
  continueWatching: MediaCard[];
  // Without the hero, when it came from this row or from Continue watching with nothing else in it.
  recentlyAdded: MediaCard[];
}

export function composeHome(lists: HomeLists, options: { window: ContinueWindow; now: number }): Home {
  const recentlyAdded = lists.recentlyAdded ?? [];
  const { row, agedOutIds } = continueWatchingRow({
    resume: lists.resume ?? [],
    nextUp: lists.nextUp ?? [],
    plays: lists.recentlyPlayed,
    window: options.window,
    now: options.now,
  });
  const hero = pickUpNext({ row, agedOutIds, sequel: undefined, similar: undefined, latest: [recentlyAdded] });
  if (hero.rule === "none") return { hero, continueWatching: row, recentlyAdded };
  const heroId = hero.card.id;
  const without = (cards: MediaCard[]) => cards.filter((card) => card.id !== heroId);
  const continueWatching = hero.rule === "row" ? without(row) : row;
  // Recently added is the row below the hero when Continue watching has nothing left to show.
  const belowHero = hero.rule === "newest" || continueWatching.length === 0;
  return { hero, continueWatching, recentlyAdded: belowHero ? without(recentlyAdded) : recentlyAdded };
}
