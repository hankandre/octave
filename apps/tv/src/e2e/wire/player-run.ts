// What the player's wire tests share (T8-02, docs/specs/T8-02.md "The wire tests"): sign in through the gateway, find a
// movie by its name, negotiate with createPlaybackPlan, build the launch with the core's launchRequest (the core builds
// every URL), and drive the PlayerEngine port with fixed timeouts while every event is kept in order. Words are fixed
// words and port codes only.
import type { LibraryItem } from "@octave/core/src/domain/catalog";
import type { PlaybackPlan } from "@octave/core/src/domain/playback";
import { secondsToTicks } from "@octave/core/src/domain/playback";
import type { PlayerCapabilities, PlayerEngine, PlayerEvent } from "@octave/core/src/domain/player-engine";
import type { JellyfinGateway } from "@octave/core/src/jellyfin/gateway";
import { launchRequest } from "@octave/core/src/player/launch-request";
import { createPlayerEngine } from "../../host/player-engine";
import { loadPlayerModule } from "../../host/player-module";
import { codeOf, UNREACHABLE, wait, type WireContext, type WireOutcome } from "./wire-context";

export const FIRST_FRAME_MS = 30_000;
export const STEP_MS = 10_000;
const POLL_MS = 100;

// A signed-in gateway, or the outcome that ends the test. `statingFull` picks the gateway whose host states no device
// limit (T8-07 D3); every other test signs in with the app's probe-backed gateway.
export async function signIn(context: WireContext, options: { statingFull?: true } = {}): Promise<JellyfinGateway | WireOutcome> {
  const { base, list, seam } = context;
  const build = options.statingFull ? context.gatewayStatingFull : context.gateway;
  let gateway: JellyfinGateway;
  try {
    gateway = await build(base);
    seam.add(await gateway.connect());
  } catch (error) {
    seam.add(error);
    return codeOf(error) === "network" ? UNREACHABLE : { words: `outcome=connect-${codeOf(error)}` };
  }
  try {
    gateway.confirmUnencryptedConnection();
    seam.add(await gateway.login(list.user, list.password));
    return gateway;
  } catch (error) {
    seam.add(error);
    return { words: `outcome=login-${codeOf(error)}` };
  }
}

export const isOutcome = (value: JellyfinGateway | WireOutcome): value is WireOutcome => "words" in value || "unreachable" in value;

// The movie whose name is exactly `name`, as the library item createPlaybackPlan takes.
export async function findMovie(gateway: JellyfinGateway, name: string): Promise<LibraryItem | undefined> {
  const page = await gateway.searchItems(name, { startIndex: 0, limit: 20 });
  const card = page.cards.find((entry) => entry.title === name && entry.kind === "Movie");
  return card === undefined ? undefined : { id: card.id, name: card.title, type: "Movie", resumePositionTicks: 0, played: false };
}

// The plan's word: original for an original-file plan, else the conversion's play method.
export const planWord = (plan: PlaybackPlan) => (plan.delivery === "static" ? "original" : plan.playMethod === "Transcode" ? "transcode" : "direct-stream");

// The engine, its initialize answer, and every event it sent, in order.
export class PlayerRig {
  readonly events: PlayerEvent[] = [];
  capabilities: PlayerCapabilities = { probe: "failed" };
  private unsubscribe: (() => void) | undefined;

  private constructor(readonly engine: PlayerEngine) {}

  static async open(context: WireContext): Promise<PlayerRig> {
    const rig = new PlayerRig(createPlayerEngine(loadPlayerModule()));
    rig.capabilities = await rig.engine.initialize();
    context.seam.add(rig.capabilities);
    rig.unsubscribe = await rig.engine.subscribe((event) => {
      context.seam.add(event);
      rig.events.push(event);
    });
    return rig;
  }

  close(): void {
    this.unsubscribe?.();
  }

  // The first event at or after `from` that `match` takes, waiting at most `ms`; undefined on a timeout.
  async next(match: (event: PlayerEvent) => boolean, ms: number, from = 0): Promise<PlayerEvent | undefined> {
    for (const deadline = Date.now() + ms; ; await wait(POLL_MS)) {
      const found = this.events.slice(from).find(match);
      if (found !== undefined || Date.now() >= deadline) return found;
    }
  }

  // Launches the plan from `startSeconds` and waits for the first frame or an error: "first-frame", a port code, or
  // "timeout". `from` is where this launch's events start.
  async play(gateway: JellyfinGateway, plan: PlaybackPlan): Promise<{ word: string; from: number }> {
    const from = this.events.length;
    try {
      await this.engine.launch(launchRequest(plan, gateway.sessionId()));
    } catch (error) {
      return { word: codeOf(error), from };
    }
    const settled = await this.next((event) => event.kind === "first-frame" || event.kind === "error", FIRST_FRAME_MS, from);
    if (settled === undefined) return { word: "timeout", from };
    return { word: settled.kind === "error" ? settled.code : "first-frame", from };
  }

  // Stops the engine and waits for its `ended`: "ok", a port code, or "timeout".
  async stop(from: number): Promise<string> {
    const ended = this.events.slice(from).some((event) => event.kind === "ended");
    try {
      await this.engine.stop();
    } catch (error) {
      return codeOf(error);
    }
    if (ended) return "ok";
    return (await this.next((event) => event.kind === "ended" && event.reason === "stopped", STEP_MS, from)) === undefined ? "timeout" : "ok";
  }
}

// A plan for `name`, or the word that ends the test.
export async function planFor(gateway: JellyfinGateway, name: string, startSeconds = 0): Promise<PlaybackPlan | string> {
  try {
    const item = await findMovie(gateway, name);
    if (item === undefined) return "not-found";
    return await gateway.createPlaybackPlan(item, secondsToTicks(startSeconds));
  } catch (error) {
    return `plan-${codeOf(error)}`;
  }
}
