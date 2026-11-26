// The player screen in fixed states, for the 1920×1080 captures (T8-03 D15, T8-04 D15): PlayerScreen over a stand-in
// viewing. The release app reaches no player yet, so only the e2e app draws these, once its wire run is done, each held
// long enough to capture: the progress notice, the loading layer with a title and backdrop, a playing viewing whose
// controls the remote's keys show and pause (an arrow, then the play-pause key and Down), buffering, and last the stop
// that failed, which stays. Nothing plays and nothing is sent.
import { initialPlaybackSessionState } from "@octave/core/src/player/session-state";
import type { ViewingState } from "@octave/core/src/player/viewing";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { ArtworkProvider } from "../../design/rows/artwork";
import { colors } from "../../design/tokens";
import { PlayerScreen, PlayerServicesContext, type PlayerServices } from "../../player";
import { wait } from "./wire-context";

// Long enough to capture a screen, and then what it leaves behind.
const HOLD_MS = 15_000;
// The two captures of the controls take keys between them.
const CONTROLS_HOLD_MS = 60_000;

const snapshot: NonNullable<ViewingState["session"]["snapshot"]> = {
  positionSeconds: 1260,
  durationSeconds: 3480,
  bufferedSeconds: 1500,
  paused: false,
  buffering: false,
  volume: 100,
  muted: false,
  tracks: [],
  diagnostics: { decodeMode: "hardware", decodeLabel: "Hardware", droppedFrames: 0 },
};

const shownTitle = { name: "The Keeper's Log", seriesName: "Harbor Lights", season: 1, episode: 2 };

const playing: ViewingState = {
  phase: "playing",
  session: { ...initialPlaybackSessionState, firstFrameReady: true, snapshot },
  title: shownTitle,
};

/** A viewing that holds one state and answers pause and resume, as the controls need. */
function servicesIn(initial: ViewingState): PlayerServices {
  let state = initial;
  const listeners = new Set<() => void>();
  const setPaused = (paused: boolean): void => {
    state = { ...state, session: { ...state.session, snapshot: { ...snapshot, paused } } };
    for (const listener of [...listeners]) listener();
  };
  return {
    viewing: {
      state: () => state,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      stop: async () => undefined,
      leave: async () => undefined,
      setPaused,
      togglePaused: () => setPaused(state.session.snapshot?.paused !== true),
      seekBy: () => undefined,
    },
    // The root already draws the player view underneath.
    PlayerView: View,
    serverName: "Fixture Server",
    log: () => undefined,
  };
}

// The fixtures have no session to load a picture with, so a flat block stands where the backdrop is drawn.
function StandInArtwork() {
  return <View style={styles.art} />;
}

const noticeShown = servicesIn({ ...playing, session: { ...playing.session, reportingWarning: "report-failed" } });
const loading = servicesIn({
  phase: "loading",
  session: initialPlaybackSessionState,
  title: shownTitle,
  backdrop: { itemId: "fixture", type: "Backdrop", tag: "fixture" },
  opening: "original",
});
const controls = servicesIn(playing);
const buffering = servicesIn({ ...playing, session: { ...playing.session, snapshot: { ...snapshot, buffering: true } } });
const stopFailed = servicesIn({ phase: "failed", session: { ...initialPlaybackSessionState, failure: "stop-failed" } });

function PlayerFixtureScreen({ services }: { services: PlayerServices }) {
  return (
    <ArtworkProvider component={StandInArtwork}>
      <PlayerServicesContext.Provider value={services}>
        <PlayerScreen />
      </PlayerServicesContext.Provider>
    </ArtworkProvider>
  );
}

export async function showPlayerFixtures(show: (element: ReactElement | null) => Promise<void>): Promise<void> {
  await show(<PlayerFixtureScreen key="notice" services={noticeShown} />);
  await wait(HOLD_MS);
  await show(<PlayerFixtureScreen key="loading" services={loading} />);
  await wait(HOLD_MS);
  await show(<PlayerFixtureScreen key="controls" services={controls} />);
  await wait(CONTROLS_HOLD_MS);
  await show(<PlayerFixtureScreen key="buffering" services={buffering} />);
  await wait(HOLD_MS);
  await show(<PlayerFixtureScreen key="stop-failed" services={stopFailed} />);
}

const styles = StyleSheet.create({
  art: { flex: 1, backgroundColor: colors.surface3 },
});
