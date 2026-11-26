// The player screen over a fake viewing (frozen with T8-04). The fake publishes what the core's `Viewing` publishes
// (spec D3) and records the transport calls the screen makes: pause and toggle change its snapshot as the engine's own
// events would; `seekBy` only records.
//
// Testing contract (the implementer builds to it)
// - testIDs: player-top-bar, player-scrubber, player-controls (the three zones; none is mounted while the chrome is
//   hidden), player-back, player-title-series, player-title.
// - Accessibility labels: "Player controls" (the focus holder), "Seek" (the scrubber's focusable), "Pause" while playing
//   and "Play" while paused (Play or Pause), "Back" (the top bar's and the loading layer's control).
// - player-controls holds three buttons in this order: back 10, Play or Pause, forward 10.
// - The screen moves focus through `shell/focus-bridge` (`focusView`) and names neighbours with its `tagOf`.
// - The backdrop is drawn through the artwork slot (design/rows/artwork).
import { jest } from "@jest/globals";
import { act, render } from "@testing-library/react-native";
import { View, type ViewProps } from "react-native";
import type { ImageRef } from "@octave/core/src/domain/catalog";
import type { PlaybackSnapshot } from "@octave/core/src/domain/playback";
import type { ViewingState } from "@octave/core/src/player/viewing";
import { ReducedMotionProvider } from "../../design/motion";
import { ArtworkProvider } from "../../design/rows/artwork";
import { FakeArtwork, art, flush } from "../../home/test-support/home-doubles";
import { ShellContext } from "../../shell/shell-context";
import { snapshotAt } from "../../signed-in/test-support/signed-in-doubles";
import { PlayerScreen } from "../player-screen";
import { PlayerServicesContext, type PlayerServices } from "../player-services";

export const ITEM_ID = "ep-2";
export const BACKDROP: ImageRef = art(ITEM_ID, "Backdrop", "ep2-player-bd");
export const EPISODE_TITLE = { name: "The Keeper's Log", seriesName: "Harbor Lights", season: 1, episode: 2 };
export const FILM_TITLE = { name: "Salt Road" };

const DURATION_SECONDS = 3480;

export const playingSnapshot = (over: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot => ({
  ...snapshotAt(100),
  durationSeconds: DURATION_SECONDS,
  ...over,
});

/** The viewing as it is before the item read returned: nothing to show but that it loads. */
export const loadingState = (): ViewingState => ({ itemId: ITEM_ID, phase: "loading", session: { firstFrameReady: false } });

/** The viewing after the first frame. */
export const playingState = (): ViewingState => ({
  itemId: ITEM_ID,
  phase: "playing",
  session: { firstFrameReady: true, snapshot: playingSnapshot() },
  title: EPISODE_TITLE,
  backdrop: BACKDROP,
  opening: "original",
});

export function fakeViewing(initial: ViewingState) {
  let current = initial;
  const listeners = new Set<() => void>();

  const publish = (next: ViewingState): void => {
    current = next;
    for (const listener of [...listeners]) listener();
  };
  const change = (over: Partial<PlaybackSnapshot>): void => {
    const snapshot = { ...(current.session.snapshot ?? playingSnapshot()), ...over };
    publish({ ...current, session: { ...current.session, snapshot } });
  };

  return {
    state: (): ViewingState => current,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stop: jest.fn(async () => undefined),
    leave: jest.fn(async () => undefined),
    setPaused: jest.fn((paused: boolean) => change({ paused })),
    togglePaused: jest.fn(() => change({ paused: current.session.snapshot?.paused !== true })),
    seekBy: jest.fn((_deltaSeconds: number) => undefined),
    /** The viewing publishes new state, as an engine event or a read would make it. */
    async publish(patch: Partial<ViewingState>): Promise<void> {
      await act(async () => publish({ ...current, ...patch }));
    },
    /** The engine sends a new snapshot. */
    async snapshot(over: Partial<PlaybackSnapshot>): Promise<void> {
      await act(async () => change(over));
    },
  };
}

function FakePlayerView({ style }: Pick<ViewProps, "style">) {
  return <View testID="fake-engine-view" style={style} />;
}

export async function renderPlayer(initial: ViewingState) {
  const viewing = fakeViewing(initial);
  const close = jest.fn<() => void>();
  const services: PlayerServices = { viewing, PlayerView: FakePlayerView, serverName: "Fixture Server", log: () => undefined };
  await render(
    <ReducedMotionProvider value>
      <ArtworkProvider component={FakeArtwork}>
        <ShellContext.Provider value={{ open: jest.fn(), close, route: { kind: "play", id: ITEM_ID } }}>
          <PlayerServicesContext.Provider value={services}>
            <PlayerScreen />
          </PlayerServicesContext.Provider>
        </ShellContext.Provider>
      </ArtworkProvider>
    </ReducedMotionProvider>,
  );
  await flush();
  return { viewing, close };
}

export type PlayerRig = Awaited<ReturnType<typeof renderPlayer>>;

/** Moves the app's fake timers. */
export async function advance(milliseconds: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(milliseconds);
  });
  await flush();
}

/** The player as a viewer first sees the picture: it loaded, then the first frame arrived. */
export async function renderAfterFirstFrame(): Promise<PlayerRig> {
  const rig = await renderPlayer(loadingState());
  await rig.viewing.publish(playingState());
  await advance(0);
  return rig;
}
