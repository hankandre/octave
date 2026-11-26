// The player screen in fixed states, for the 1920×1080 captures (T8-03 D15): PlayerScreen over a viewing that never
// changes. The release app reaches no player yet, so only the e2e app draws these, once its wire run is done: first the
// progress notice, which hides itself after five seconds, then a failure, which stays. Nothing plays and nothing is sent.
import { initialPlaybackSessionState } from "@octave/core/src/player/session-state";
import type { ViewingState } from "@octave/core/src/player/viewing";
import type { ReactElement } from "react";
import { View } from "react-native";
import { PlayerScreen, PlayerServicesContext, type PlayerServices } from "../../player";
import { wait } from "./wire-context";

// Long enough to capture the notice, and then the screen it leaves behind.
const NOTICE_HOLD_MS = 15_000;

function servicesIn(state: ViewingState): PlayerServices {
  return {
    viewing: { state: () => state, subscribe: () => () => undefined, stop: async () => undefined },
    // The root already draws the player view underneath.
    PlayerView: View,
    serverName: "Fixture Server",
    log: () => undefined,
  };
}

const noticeShown = servicesIn({ phase: "playing", session: { ...initialPlaybackSessionState, reportingWarning: "report-failed" } });
const failed = servicesIn({ phase: "failed", session: { ...initialPlaybackSessionState, failure: "server-unreachable" } });

function PlayerFixtureScreen({ services }: { services: PlayerServices }) {
  return (
    <PlayerServicesContext.Provider value={services}>
      <PlayerScreen />
    </PlayerServicesContext.Provider>
  );
}

export async function showPlayerFixtures(show: (element: ReactElement | null) => Promise<void>): Promise<void> {
  await show(<PlayerFixtureScreen key="notice" services={noticeShown} />);
  await wait(NOTICE_HOLD_MS);
  await show(<PlayerFixtureScreen key="failure" services={failed} />);
}
