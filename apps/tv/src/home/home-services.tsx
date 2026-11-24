// What Home needs from the app (T5-03 D2): one context value, so the composition root wires it in one place and a screen
// constructs no gateway (DOMAINS.md §8). With no services Home draws an empty screen and requests nothing.
import { createContext } from "react";
import type { HomeClock, HomeSource } from "@octave/core/src/domain/home";
import type { HeroSource, PlayRequest } from "@octave/core/src/domain/home-hero";
import type { ContinueWindow } from "@octave/core/src/domain/up-next";

export type HomeServices = {
  /** The signed-in gateway satisfies both structurally. */
  source: HomeSource & HeroSource;
  clock: HomeClock;
  /** The account's Continue watching window, read once per load; undefined gives the default. */
  window?: () => ContinueWindow | undefined;
  /** The playback use case (T8-03): an item id and where to start. Opening the player is its job, not Home's. */
  play(request: PlayRequest): void;
};

export const HomeServicesContext = createContext<HomeServices | undefined>(undefined);
