// What the player screen needs from the app (T8-03 D2): one context value, so the composition root wires it in one place
// and the screen constructs no gateway or engine (DOMAINS.md §8).
import { createContext, type ComponentType } from "react";
import type { Viewing } from "@octave/core/src/player/viewing";
import type { FailureLog } from "@octave/core/src/ports/failure-log";
import type { PlayerViewProps } from "../host/player-view";

export type PlayerServices = {
  /** The viewing the screen shows and ends. Starting one is Home's `play`, not the screen's. */
  viewing: Pick<Viewing, "state" | "subscribe" | "stop">;
  /** The engine's video view. */
  PlayerView: ComponentType<PlayerViewProps>;
  serverName: string;
  log: FailureLog;
};

export const PlayerServicesContext = createContext<PlayerServices | undefined>(undefined);
