// Doubles for the T8-03 app tests (frozen with T8-03): a signed-in gateway that keeps the viewer's position as a server
// would, the core's port-only fake engine, a fake player view, the app's Back button and the render of `SignedInApp`.
//
// Testing contract (the implementer builds to it)
// - `SignedInApp` (../signed-in-app) takes `{ gateway, serverName, engine, PlayerView, clock }` and draws the shell with Home
//   for `home` and the player screen for `play`.
// - The gateway double answers what Home reads, what `playbackGatewayOf` forwards, and `userViews` (no library).
// - testIDs: player-screen, player-view, player-osd (the player screen), fake-engine-view (this file's view).
// - Each file that renders the app mocks `@shopify/flash-list` and `shell/focus-bridge` with their frozen doubles.
import { jest } from "@jest/globals";
import { act, render, screen } from "@testing-library/react-native";
import { BackHandler, View, type ViewProps } from "react-native";
import type { ItemDetail, MediaCard } from "@octave/core/src/domain/catalog";
import { secondsToTicks, type PlaybackPlan, type PlaybackSnapshot } from "@octave/core/src/domain/playback";
import type { RecentPlays } from "@octave/core/src/domain/up-next";
import { createFakePlayerEngine } from "@octave/core/src/player/fake-player-engine";
import { FakeClock } from "@octave/core/src/ports/fake-clock";
import { ReducedMotionProvider } from "../../design/motion";
import { testIDOf, focusView } from "../../shell/test-support/focus-bridge-double";
import { MINUTE, NOW, cwEpisode, cwFilm, detailOf, flush, newMovie, newSeries, textOf } from "../../home/test-support/home-doubles";
import { SignedInApp } from "../signed-in-app";

export const SERVER_NAME = "Fixture Server";
export const SESSION_ID = "session-1";

const TICKS_PER_SECOND = MINUTE / 60;
const ROUNDS = 30;

/** The runtime of each title the server double holds, in ticks. */
const RUN_TIME_TICKS: Record<string, number> = { "ep-2": 58 * MINUTE, "film-4": 100 * MINUTE };
const OTHER_RUN_TIME_TICKS = 120 * MINUTE;

export const streamUrlOf = (itemId: string): string => `https://media.test/Videos/${itemId}/stream?Static=true`;

export function planOf(itemId: string, startPositionTicks: number): PlaybackPlan {
  return {
    itemId,
    title: `Title ${itemId}`,
    streamUrl: streamUrlOf(itemId),
    mediaSourceId: `source-${itemId}`,
    playSessionId: `play-session-${itemId}-${startPositionTicks}`,
    startPositionTicks,
    tracks: [],
    delivery: "static",
    playMethod: "DirectPlay",
    conversionReasons: [],
  };
}

export function snapshotAt(positionSeconds: number, paused = false): PlaybackSnapshot {
  return {
    positionSeconds,
    paused,
    buffering: false,
    volume: 100,
    muted: false,
    tracks: [],
    diagnostics: { decodeMode: "hardware", decodeLabel: "Hardware", droppedFrames: 0 },
  };
}

/** The lists of these tests: the hero is the episode `cwEpisode`, and Continue watching holds `cwFilm` below it. */
function lists(): { resume: MediaCard[]; nextUp: MediaCard[]; recentlyPlayed: RecentPlays; latest: MediaCard[] } {
  return { resume: [cwEpisode, cwFilm], nextUp: [], recentlyPlayed: { entries: [], complete: true }, latest: [newMovie, newSeries] };
}

/** A signed-in gateway over one in-memory viewer: a Stopped report moves the position the next item read gives. */
export function fakeGateway() {
  const answers = lists();
  const positions = new Map<string, number>(answers.resume.map((card) => [card.id, card.resumePositionTicks ?? 0]));

  const detail = (id: string): ItemDetail => {
    const card = answers.resume.find((candidate) => candidate.id === id);
    return detailOf(id, {
      type: card?.kind === "Episode" ? "Episode" : "Movie",
      title: card?.title ?? `Title ${id}`,
      runTimeTicks: RUN_TIME_TICKS[id] ?? OTHER_RUN_TIME_TICKS,
      userData: { played: false, favorite: false, resumePositionTicks: positions.get(id) ?? 0 },
    });
  };

  return {
    userViews: jest.fn(async () => []),
    resumeItems: jest.fn(async () => answers.resume),
    nextUp: jest.fn(async () => answers.nextUp),
    recentlyPlayed: jest.fn(async () => answers.recentlyPlayed),
    latestItems: jest.fn(async () => answers.latest),
    seriesNextUp: jest.fn(async () => undefined),
    itemDetail: jest.fn(async (id: string, _signal?: AbortSignal) => detail(id)),
    createPlaybackPlan: jest.fn(async (item: { id: string }, startPositionTicks: number, _signal?: AbortSignal, _mediaSourceId?: string, _options?: object) =>
      planOf(item.id, startPositionTicks),
    ),
    reportStart: jest.fn(async (_plan: PlaybackPlan, _snapshot: PlaybackSnapshot, _signal?: AbortSignal) => undefined),
    reportProgress: jest.fn(async (_plan: PlaybackPlan, _snapshot: PlaybackSnapshot, _signal?: AbortSignal) => undefined),
    reportStopped: jest.fn(async (plan: PlaybackPlan, snapshot: PlaybackSnapshot, _signal?: AbortSignal, failed?: boolean) => {
      if (failed !== true) positions.set(plan.itemId, secondsToTicks(snapshot.positionSeconds));
    }),
    stopActiveEncoding: jest.fn(async (_playSessionId: string) => undefined),
    sessionPlayMethod: jest.fn(async () => undefined),
    sessionId: jest.fn(() => SESSION_ID),
  };
}

export const ticksToWholeSeconds = (ticks: number): number => ticks / TICKS_PER_SECOND;

function FakeEngineView({ style }: Pick<ViewProps, "style">) {
  return <View testID="fake-engine-view" style={style} />;
}

type Listener = () => boolean | null | undefined;

/** Records the app's Back listeners. The last one registered is the shell's, since React Navigation registers its own first. */
export function captureBack() {
  let listeners: Listener[] = [];
  jest.spyOn(BackHandler, "addEventListener").mockImplementation(((_name: string, handler: Listener) => {
    listeners.push(handler);
    return {
      remove: () => {
        listeners = listeners.filter((listener) => listener !== handler);
      },
    };
  }) as never);
  jest.spyOn(BackHandler, "exitApp").mockImplementation(() => undefined);
  return async function pressBack(): Promise<void> {
    const listener = listeners.at(-1);
    if (listener === undefined) throw new Error("no Back listener was registered");
    await act(async () => {
      listener();
    });
    await settle();
  };
}

/** Lets the navigator's timers run and every settled promise reach the screen. */
export async function settle(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  await flush(ROUNDS);
}

/** Lets settled promises reach the screen without moving the app's timers. */
export const drain = (): Promise<void> => flush(ROUNDS);

export async function renderSignedInApp() {
  const gateway = fakeGateway();
  const player = createFakePlayerEngine();
  const launch = jest.spyOn(player.engine, "launch");
  const stop = jest.spyOn(player.engine, "stop");
  const setPaused = jest.spyOn(player.engine, "setPaused");
  const clock = new FakeClock(NOW);
  await render(
    <ReducedMotionProvider value>
      <SignedInApp gateway={gateway as never} serverName={SERVER_NAME} engine={player.engine} PlayerView={FakeEngineView} clock={clock} />
    </ReducedMotionProvider>,
  );
  await settle();
  return { gateway, player, launch, stop, setPaused, clock };
}

export type SignedInRig = Awaited<ReturnType<typeof renderSignedInApp>>;

/** Sends events as the engine would, then lets them reach the core and the screen. */
export async function emit(rig: SignedInRig, ...events: Parameters<SignedInRig["player"]["emit"]>[0][]): Promise<void> {
  await act(async () => {
    for (const event of events) rig.player.emit(event);
  });
  await drain();
}

/** Moves the core's clock past every report and drain deadline, so a late report would have been sent by now. */
export async function outlast(rig: SignedInRig): Promise<void> {
  await act(async () => {
    await rig.clock.advance(60_000);
  });
  await drain();
}

/** The testID of the view the shell last asked to take focus. */
export const lastFocused = (): string | undefined => testIDOf(focusView.mock.calls.at(-1)?.[0]);

/** Every card title of Home's rows, in the order they render. */
export const cardTitles = (): string[] =>
  screen.queryAllByTestId(/^home-rows-row-[a-z-]+-card-\d+-title$/).map((element) => textOf(String(element.props.testID)));
