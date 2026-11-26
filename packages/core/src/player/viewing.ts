import type { ImageRef, ItemDetail, LibraryItem } from "../domain/catalog";
import type { PlayRequest } from "../domain/home-hero";
import {
  PlayerEngineError,
  playerErrorCode,
  resumeChoice,
  startOverChoice,
  type PlaybackEndReason,
  type PlaybackPlan,
  type PlaybackStartChoice,
  type PlayerEngine,
  type PlayerEvent,
} from "../domain/playback";
import type { Clock } from "../ports/clock";
import type { FailureLog } from "../ports/failure-log";
import { PlaybackCancelledError, PlaybackCoordinator, PlayerStopError, type PlaybackGateway } from "./coordinator";
import { failureAction, logFailure, reportingWarningAction } from "./session-failure";
import {
  initialPlaybackSessionState,
  playbackSessionReducer,
  type PlaybackSessionAction,
  type PlaybackSessionState,
} from "./session-state";
import { PendingIntents } from "./transport-intents";

export interface ViewingSource extends PlaybackGateway {
  itemDetail(id: string, signal?: AbortSignal): Promise<ItemDetail>;
}

export type ViewingPhase = "idle" | "loading" | "playing" | "ended" | "failed";

// What the player says it plays. A film has a name alone.
export type ViewingTitle = { name: string; seriesName?: string; season?: number; episode?: number };

export type ViewingState = {
  itemId?: string;
  phase: ViewingPhase;
  session: PlaybackSessionState;
  // From the item read, as is the backdrop, when the item has one.
  title?: ViewingTitle;
  backdrop?: ImageRef;
  // A direct-play plan is known. Absent before a plan and for a conversion.
  opening?: "original";
  // Seconds: the target of the newest seek that has not landed.
  seekingTo?: number;
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

function titleOf(detail: ItemDetail): ViewingTitle {
  if (detail.type !== "Episode") return { name: detail.title };
  const { seriesName, seasonNumber, episodeNumber } = detail;
  return {
    name: detail.title,
    ...(seriesName === undefined ? {} : { seriesName }),
    ...(seasonNumber === undefined ? {} : { season: seasonNumber }),
    ...(episodeNumber === undefined ? {} : { episode: episodeNumber }),
  };
}

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
  // Set once a plan is about to be launched: before that the engine was handed nothing.
  launched: boolean;
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
  private readonly pauses = new PendingIntents<boolean>();
  private readonly seeks = new PendingIntents<number>();
  // The titles handed to the coordinator: a card for one may be older than that viewing.
  private readonly startedItems = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly viewedListeners = new Set<(itemId: string) => void>();

  constructor(
    private readonly source: ViewingSource,
    private readonly engine: PlayerEngine,
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
        onPlan: (plan) => this.handlePlan(plan),
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
      launched: false,
      starting: false,
      endedUnexplained: false,
    };
    this.latest = run;
    this.running = run;
    this.pauses.clear();
    this.seeks.clear();
    this.publish({ itemId: request.itemId, phase: "loading", session: initialPlaybackSessionState });
    void this.open(run);
    return true;
  }

  // Back. Resolves once the Stopped report settled or hit its deadline; rejects when the engine did not stop.
  stop(): Promise<void> {
    const run = this.running;
    if (!run) return this.stopFailed ? this.retryStop() : this.settled;
    run.controller.abort();
    this.setPhase(run, "idle");
    return this.conclude(run, () => (run.started ? this.stopCoordinator() : run.earlier));
  }

  // The player screen's Back: the stop of `stop()`, but it resolves as soon as the engine has stopped, or at once when
  // nothing was launched, while the reports go on. Rejects with PlayerStopError when the engine did not stop, which
  // the state then says, and may be called again.
  leave(): Promise<void> {
    const run = this.running;
    if (!run) return this.stopFailed ? this.reportFailedStop(this.latest, this.retryStop()) : Promise.resolve();
    run.controller.abort();
    this.setPhase(run, "idle");
    const stopped = run.started ? this.stopCoordinator() : Promise.resolve();
    // The conclusion waits for the same stop, then flushes and announces; its rejection is `stopped`'s own.
    this.conclude(run, () => (run.started ? stopped : run.earlier)).catch(() => undefined);
    return run.launched ? this.reportFailedStop(run, stopped) : Promise.resolve();
  }

  // Pause, resume and seek reach the engine only while playing. Their reports follow from the engine's own events.
  setPaused(paused: boolean): void {
    if (this.current.phase !== "playing") return;
    const intent = this.pauses.add(paused);
    this.engine.setPaused(paused).catch((error: unknown) => {
      this.pauses.withdraw(intent);
      logFailure(error, this.log);
    });
  }

  togglePaused(): void {
    const paused = this.pauses.latest() ?? this.current.session.snapshot?.paused ?? false;
    this.setPaused(!paused);
  }

  seekBy(deltaSeconds: number): void {
    const { phase, session } = this.current;
    if (phase !== "playing" || !session.snapshot) return;
    const { positionSeconds, durationSeconds = Number.POSITIVE_INFINITY } = session.snapshot;
    const base = this.seeks.latest() ?? positionSeconds;
    const target = Math.max(0, Math.min(base + deltaSeconds, durationSeconds));
    const intent = this.seeks.add(target);
    this.publishSeekingTo();
    this.engine.seek(target).catch((error: unknown) => {
      this.seeks.withdraw(intent);
      this.publishSeekingTo();
      logFailure(error, this.log);
    });
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
      this.update(run, { title: titleOf(detail), backdrop: detail.backdrop });
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

  // The viewing already concluded when its stop failed, so only the engine is asked again.
  private retryStop(): Promise<void> {
    const stopped = this.stopCoordinator();
    this.settled = stopped.then(() => this.coordinator.flush()).catch(() => undefined);
    return stopped;
  }

  private async reportFailedStop(run: Run | undefined, stopped: Promise<void>): Promise<void> {
    try {
      await stopped;
    } catch (error) {
      if (run) this.fail(run, error);
      throw error instanceof PlayerStopError ? error : new PlayerStopError();
    }
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
    if (event.kind === "state") this.retireIntent(run, event.cause);
    if (event.kind === "first-frame" && this.current.phase === "loading") this.setPhase(run, "playing");
  }

  private handlePlan(plan: PlaybackPlan): void {
    const run = this.driving;
    if (!run) return;
    run.launched = true;
    if (plan.delivery === "static") this.update(run, { opening: "original" });
  }

  private retireIntent(run: Run, cause: "pause" | "seek" | "property" | undefined): void {
    if (run !== this.latest) return;
    switch (cause) {
      case "pause":
        this.pauses.landed();
        break;
      case "seek":
        this.seeks.landed();
        this.publishSeekingTo();
        break;
      default:
        break;
    }
  }

  private publishSeekingTo(): void {
    const seekingTo = this.seeks.latest();
    if (seekingTo !== this.current.seekingTo) this.publish({ ...this.current, seekingTo });
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

  private update(run: Run, patch: Partial<ViewingState>): void {
    if (run === this.latest) this.publish({ ...this.current, ...patch });
  }

  private publish(state: ViewingState): void {
    this.current = state;
    for (const listener of [...this.listeners]) listener();
  }
}
