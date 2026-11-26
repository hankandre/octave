// What the wire tests that drive the app's Viewing share (player-viewing, T8-03; player-transport, T8-04): the 60 s
// episode they play, and waiting on the viewing's state.
import type { JellyfinGateway } from "@octave/core/src/jellyfin/gateway";
import type { Viewing, ViewingState } from "@octave/core/src/player/viewing";

const SERIES = "Synthetic Show";
export const PLAY_MS = 60_000;

// Ends a step with the word the result line carries.
export class Ended extends Error {
  constructor(readonly word: string) {
    super(word);
  }
}

// The episode's id: season 1, episode 1 of the series.
export async function findEpisode(gateway: JellyfinGateway): Promise<string> {
  const page = await gateway.searchItems(SERIES, { startIndex: 0, limit: 20 });
  const series = page.cards.find((card) => card.title === SERIES && card.kind === "Series");
  if (series === undefined) throw new Ended("series-not-found");
  const season = (await gateway.seasons(series.id)).find((entry) => entry.indexNumber === 1);
  if (season === undefined) throw new Ended("season-not-found");
  const episode = (await gateway.episodes(series.id, season.id)).find((card) => card.episodeNumber === 1);
  if (episode === undefined) throw new Ended("episode-not-found");
  return episode.id;
}

// Resolves with what `read` takes from the viewing's state, read as the state is published, so nothing that follows the
// publish has run yet. A failed viewing or `ms` without an answer ends the step.
export function awaitState<Result>(viewing: Viewing, ms: number, step: string, read: (state: ViewingState) => Result | undefined): Promise<Result> {
  return new Promise((resolve, reject) => {
    let unsubscribe: () => void = () => undefined;
    const settle = (finish: () => void) => {
      clearTimeout(timer);
      unsubscribe();
      finish();
    };
    const check = () => {
      const state = viewing.state();
      if (state.phase === "failed") {
        settle(() => reject(new Ended(`${step}-${state.session.failure ?? "failed"}`)));
        return;
      }
      const result = read(state);
      if (result !== undefined) settle(() => resolve(result));
    };
    const timer = setTimeout(() => settle(() => reject(new Ended(`${step}-timeout`))), ms);
    unsubscribe = viewing.subscribe(check);
    check();
  });
}

export const positionOf = (state: ViewingState) => state.session.snapshot?.positionSeconds;
