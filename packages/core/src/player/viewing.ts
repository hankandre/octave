import type { ItemDetail, LibraryItem } from "../domain/catalog";
import type { PlayRequest } from "../domain/home-hero";
import {
  PlayerEngineError,
  playerErrorCode,
  resumeChoice,
  startOverChoice,
  type PlaybackEndReason,
  type PlaybackStartChoice,
  type PlayerEngine,
  type PlayerEvent,
} from "../domain/playback";
import type { Clock } from "../ports/clock";
import type { FailureLog } from "../ports/failure-log";
import { PlaybackCancelledError, PlaybackCoordinator, type PlaybackGateway } from "./coordinator";
import { failureAction, reportingWarningAction } from "./session-failure";
import {
  initialPlaybackSessionState,
  playbackSessionReducer,
  type PlaybackSessionAction,
  type PlaybackSessionState,
} from "./session-state";

export interface ViewingSource extends PlaybackGateway {
  itemDetail(id: string, signal?: AbortSignal): Promise<ItemDetail>;
}

export type ViewingPhase = "idle" | "loading" | "playing" | "ended" | "failed";

export type ViewingState = {
  itemId?: string;
  phase: ViewingPhase;
  session: PlaybackSessionState;
};

// What has nothing of its own to play: a show, a collection or a folder.
const UNPLAYABLE_TYPES: ReadonlySet<string> = new Set([
  "Series",
  "Season",
  "BoxSet",
  "Folder",
  "CollectionFolder",
  "UserView",
  "AggregateFolder",
]);

export function toLibraryItem(detail: ItemDetail): LibraryItem {
  if (UNPLAYABLE_TYPES.has(detail.type)) throw new Error("This item cannot be played.");
  const { seriesName, seasonNumber, episodeNumber, year, runTimeTicks, overview } = detail;
  return {
    id: detail.id,
    name: detail.title,
    type: detail.type === "Episode" ? "Episode" : "Movie",
    ...(seriesName === undefined ? {} : { seriesName }),
    ...(seasonNumber === undefined ? {} : { season: seasonNumber }),
    ...(episodeNumber === undefined ? {} : { episode: episodeNumber }),
    ...(year === undefined ? {} : { productionYear: year }),
    ...(runTimeTicks === undefined ? {} : { runTimeTicks }),
    ...(overview === undefined ? {} : { overview }),
    resumePositionTicks: detail.userData.resumePositionTicks,
    played: detail.userData.played,
  };
}

// One title from Play until it ends.
interface Run {
  request: PlayRequest;
  // Aborted by the viewer's stop.
  controller: AbortController;
  // Resolves once every earlier viewing has ended.
  earlier: Promise<void>;
  // Set once the coordinator was asked to start, so ending it goes through the coordinator.
  started: boolean;
  // Set while that start is pending: its rejection says why a session ended in error.
  starting: boolean;
  // The session ended in error while the start was pending, with no cause known yet.
  endedUnexplained: boolean;
}

// Runs one viewing at a time: reads the item, hands it to the coordinator and keeps what a player screen shows.
export class Viewing {
  private readonly coordinator: PlaybackCoordinator;
  private current: ViewingState = { phase: "idle", session: initialPlaybackSessionState };
  // The viewing asked for last; only it may change the state.
  private latest?: Run;
  // The viewing that has not begun to end.
  private running?: Run;
  // The viewing the coordinator's callbacks belong to.
  private driving?: Run;
  private settled: Promise<void> = Promise.resolve();
  // The engine did not stop, so the coordinator still holds that session.
  private stopFailed = false;
  // The titles handed to the coordinator: a card for one may be older than that viewing.
  private readonly startedItems = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly viewedListeners = new Set<(itemId: string) => void>();

  constructor(
    private readonly source: ViewingSource,
    engine: PlayerEngine,
    clock: Clock,
    private readonly log: FailureLog,
  ) {
    this.coordinator = new PlaybackCoordinator(
      source,
      engine,
      {
        onEvent: (event) => this.handleEvent(event),
        onReportingError: (message) => this.dispatch(this.driving, reportingWarningAction(message, log)),
        onSessionEnded: (reason) => this.handleSessionEnd(reason),
      },
      clock,
    );
  }

  // Never throws: a failure becomes state. False when ignored, because a viewing is loading or playing.
  play(request: PlayRequest): boolean {
    if (this.running) return false;
    const run: Run = {
      request,
      controller: new AbortController(),
      earlier: this.settled,
      started: false,
      starting: false,
      endedUnexplained: false,
    };
    this.latest = run;
    this.running = run;
    this.publish({ itemId: request.itemId, phase: "loading", session: initialPlaybackSessionState });
    void this.open(run);
    return true;
  }

  // Back. Resolves once the Stopped report settled or hit its deadline; rejects when the engine did not stop.
  stop(): Promise<void> {
    const run = this.running;
    if (!run) return this.settled;
    run.controller.abort();
    this.setPhase(run, "idle");
    return this.conclude(run, () => (run.started ? this.stopCoordinator() : run.earlier));
  }

  state(): ViewingState {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // Called once per viewing, after it ended in any way. It waits for the reports only up to their deadlines, so it is
  // called whether or not the Stopped report arrived.
  afterViewing(listener: (itemId: string) => void): () => void {
    this.viewedListeners.add(listener);
    return () => {
      this.viewedListeners.delete(listener);
    };
  }

  private async open(run: Run): Promise<void> {
    const { signal } = run.controller;
    try {
      await run.earlier;
      if (signal.aborted) return;
      if (this.stopFailed) {
        await this.stopCoordinator();
        // The stopped session's reports go before this viewing reads the position.
        await this.coordinator.flush();
      }
      const detail = await this.source.itemDetail(run.request.itemId, signal);
      if (signal.aborted) return;
      const item = toLibraryItem(detail);
      const start = this.startFor(run.request, item);
      this.startedItems.add(item.id);
      run.started = true;
      run.starting = true;
      this.driving = run;
      await this.coordinator.start(item, start);
      run.starting = false;
      if (run.endedUnexplained && this.running === run) this.end(run, "error");
    } catch (error) {
      // A viewing that already ended has said why.
      if (signal.aborted || error instanceof PlaybackCancelledError || this.running !== run) return;
      this.fail(run, error);
      void this.conclude(run, () => Promise.resolve());
    }
  }

  // A card for a title already played here may not show that viewing yet. Such a title starts from `item` instead, the
  // server's answer read after the earlier reports drained: what a refreshed card would ask for.
  private startFor(request: PlayRequest, item: LibraryItem): PlaybackStartChoice {
    if (!this.startedItems.has(item.id)) return request.start;
    return resumeChoice(item) ?? startOverChoice();
  }

  private async stopCoordinator(): Promise<void> {
    try {
      await this.coordinator.stop();
      this.stopFailed = false;
    } catch (error) {
      this.stopFailed = true;
      throw error;
    }
  }

  private conclude(run: Run, close: () => Promise<void>): Promise<void> {
    this.running = undefined;
    const concluded = this.closeAndAnnounce(run, close);
    this.settled = concluded.catch(() => undefined);
    return concluded;
  }

  private async closeAndAnnounce(run: Run, close: () => Promise<void>): Promise<void> {
    try {
      await close();
    } finally {
      await this.coordinator.flush();
      for (const listener of [...this.viewedListeners]) listener(run.request.itemId);
    }
  }

  private handleEvent(event: PlayerEvent): void {
    const run = this.driving;
    if (!run) return;
    // An error event alone ends nothing, so only the code is kept; the session's end sets the phase.
    if (event.kind === "error") this.dispatch(run, failureAction(new PlayerEngineError(playerErrorCode(event.code)), this.log));
    // After the failure, so the reducer's code for the event wins: a failed stop is not an engine code.
    this.dispatch(run, { type: "event", event });
    if (event.kind === "first-frame" && this.current.phase === "loading") this.setPhase(run, "playing");
  }

  // The session ended without the viewer's stop, which concludes the viewing itself.
  private handleSessionEnd(reason: PlaybackEndReason): void {
    const run = this.driving;
    if (!run || this.running !== run) return;
    if (reason === "error" && run.starting && !this.current.session.failure) {
      run.endedUnexplained = true;
      return;
    }
    this.end(run, reason);
  }

  private end(run: Run, reason: PlaybackEndReason): void {
    if (reason !== "error") this.setPhase(run, "ended");
    else if (this.current.session.failure) this.setPhase(run, "failed");
    else this.fail(run, new PlayerEngineError("unknown"));
    void this.conclude(run, () => Promise.resolve());
  }

  private fail(run: Run, error: unknown): void {
    this.dispatch(run, failureAction(error, this.log));
    this.setPhase(run, "failed");
  }

  private dispatch(run: Run | undefined, action: PlaybackSessionAction): void {
    if (!run || run !== this.latest) return;
    const session = playbackSessionReducer(this.current.session, action);
    if (session !== this.current.session) this.publish({ ...this.current, session });
  }

  private setPhase(run: Run, phase: ViewingPhase): void {
    if (run !== this.latest || this.current.phase === phase) return;
    this.publish({ ...this.current, phase });
  }

  private publish(state: ViewingState): void {
    this.current = state;
    for (const listener of [...this.listeners]) listener();
  }
}
