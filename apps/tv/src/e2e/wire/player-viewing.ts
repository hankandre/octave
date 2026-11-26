// Wire test player-viewing (T8-03 items 2, 4, 7 and 8, D10): two viewings of a 60 s episode from the pinned
// Jellyscale, run by the app's Viewing over the Media3 engine. The first starts over, pauses at 12 s and stops past 25 s;
// then the resume list is read as another client would read it, and the second viewing starts from Home's own play
// request over that card. The host judges the three playstate reports on the wire. Words are fixed words and port codes
// only.
import { playRequestOf } from "@octave/core/src/domain/home-hero";
import { startOverChoice } from "@octave/core/src/domain/playback";
import { playbackGatewayOf } from "@octave/core/src/jellyfin/playback-gateway";
import { Viewing } from "@octave/core/src/player/viewing";
import { hostClock } from "../../host/clock";
import { createPlayerEngine } from "../../host/player-engine";
import { loadPlayerModule } from "../../host/player-module";
import { FIRST_FRAME_MS, isOutcome, signIn, STEP_MS } from "./player-run";
import type { SeamRecorder } from "./seam-recorder";
import { awaitState, Ended, findEpisode, PLAY_MS, positionOf } from "./viewing-run";
import { codeOf, wait, type WireContext, type WireOutcome } from "./wire-context";

const PAUSE_AT_SECONDS = 12;
const PAUSE_MS = 2_000;
// Inside Jellyscale's resume window for a 60 s runtime (3 s to 54 s), so the stop keeps a resume point.
const STOP_PAST_SECONDS = 25;
const TICKS_PER_SECOND = 10_000_000;
const SAME_SECONDS = 1;
const NEAR_SECONDS = 10;

const awaitPosition = (viewing: Viewing, seconds: number, step: string) =>
  awaitState(viewing, PLAY_MS, step, (state) => ((positionOf(state) ?? 0) > seconds ? true : undefined));

// Whether the start report crossed into native after the first frame was published.
function startWord(seam: SeamRecorder, crossedAtFirstFrame: number): string {
  const sent = seam.crossings.findIndex((crossing) => {
    const argument = crossing.value as { path?: unknown } | null;
    return crossing.direction === "argument" && argument?.path === "/Sessions/Playing";
  });
  if (sent < 0) return "missing";
  return sent >= crossedAtFirstFrame ? "after-first-frame" : "before-first-frame";
}

function resumeWord(resumeSeconds: number | undefined, stoppedSeconds: number): string {
  if (resumeSeconds === undefined) return "missing";
  const apart = Math.abs(resumeSeconds - stoppedSeconds);
  if (apart < SAME_SECONDS) return "at-reported";
  return apart < NEAR_SECONDS ? "within-10s" : "far";
}

// Plays from the start, pauses and resumes, and stops: the start's word and where it stopped.
async function firstViewing(context: WireContext, viewing: Viewing, engine: ReturnType<typeof createPlayerEngine>, itemId: string) {
  viewing.play({ itemId, start: startOverChoice() });
  const crossed = await awaitState(viewing, FIRST_FRAME_MS, "first", (state) => (state.session.firstFrameReady ? context.seam.crossings.length : undefined));
  await awaitPosition(viewing, PAUSE_AT_SECONDS, "pause");
  await engine.setPaused(true);
  await wait(PAUSE_MS);
  await engine.setPaused(false);
  await awaitPosition(viewing, STOP_PAST_SECONDS, "play");
  await viewing.stop();
  const stopped = positionOf(viewing.state());
  if (stopped === undefined) throw new Ended("no-stop-position");
  return { start: startWord(context.seam, crossed), stopped };
}

// The second viewing from `request`: whether its first position after the first frame is near the saved one.
async function secondViewing(viewing: Viewing, request: NonNullable<ReturnType<typeof playRequestOf>>, savedSeconds: number): Promise<string> {
  viewing.play(request);
  const atFirstFrame = await awaitState(viewing, FIRST_FRAME_MS, "resumed", (state) => (state.session.firstFrameReady ? { snapshot: state.session.snapshot } : undefined));
  const next = await awaitState(viewing, STEP_MS, "resumed", (state) => (state.session.snapshot === atFirstFrame.snapshot ? undefined : positionOf(state)));
  await viewing.stop();
  return Math.abs(next - savedSeconds) <= NEAR_SECONDS ? "within-10s" : "far";
}

export async function run(context: WireContext): Promise<WireOutcome> {
  const gateway = await signIn(context);
  if (isOutcome(gateway)) return gateway;
  const engine = createPlayerEngine(loadPlayerModule());
  const viewing = new Viewing(playbackGatewayOf(gateway), engine, hostClock, () => undefined);
  try {
    const itemId = await findEpisode(gateway);
    // Clears the resume point an earlier run left.
    await gateway.setPlayed(itemId, false);
    const first = await firstViewing(context, viewing, engine, itemId);
    const card = (await gateway.resumeItems()).find((entry) => entry.id === itemId);
    const saved = card?.resumePositionTicks === undefined ? undefined : card.resumePositionTicks / TICKS_PER_SECOND;
    const words = [`start=${first.start}`, `resume=${resumeWord(saved, first.stopped)}`];
    const request = card === undefined ? undefined : playRequestOf(card);
    if (request === undefined || saved === undefined) return { words: `outcome=ok ${words.join(" ")} resumed=no-card` };
    words.push(`resumed=${await secondViewing(viewing, request, saved)}`);
    return { words: `outcome=ok ${words.join(" ")}` };
  } catch (error) {
    context.seam.add(error);
    return { words: `outcome=${error instanceof Ended ? error.word : codeOf(error)}` };
  } finally {
    context.seam.add(viewing.state());
    // Ends a viewing a failed step left running; a finished one is already stopped.
    await viewing.stop().catch(() => undefined);
  }
}
