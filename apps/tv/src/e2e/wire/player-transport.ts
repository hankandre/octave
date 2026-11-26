// Wire test player-transport (T8-04, D13): the real player screen over the native view, playing a 60 s episode from the
// pinned Jellyscale, driven by the remote's keys. The app only asks the runner for a key by name; the runner sends it
// with adb, so it reaches the screen as a remote's key does. The host judges the playstate reports on the wire against
// its own list of the keys it sent, and the window's keep-screen-on flag from its own reads. Words are fixed words and
// port codes only.
//
// Nothing here calls the viewing's stop or leave before the stop=back word is decided: only the screen's Back may stop.
import { startOverChoice } from "@octave/core/src/domain/playback";
import { playbackGatewayOf } from "@octave/core/src/jellyfin/playback-gateway";
import { Viewing, type ViewingState } from "@octave/core/src/player/viewing";
import { createElement } from "react";
import { motion } from "../../design/tokens";
import { hostClock } from "../../host/clock";
import { createPlayerEngine } from "../../host/player-engine";
import { loadPlayerModule } from "../../host/player-module";
import { loadPlayerView } from "../../host/player-view";
import { PlayerScreen, PlayerServicesContext, type PlayerServices } from "../../player";
import { ShellContext, type ShellApi } from "../../shell/shell-context";
import { FIRST_FRAME_MS, isOutcome, signIn, STEP_MS } from "./player-run";
import { awaitState, Ended, findEpisode, PLAY_MS, positionOf } from "./viewing-run";
import { codeOf, wait, type WireContext, type WireOutcome } from "./wire-context";

const WAKE_PAST_SECONDS = 2;
// An arrow that seeked would have moved the position by 10 s; the two keys of the first step take less than this.
const NO_SEEK_SECONDS = 8;
const SEEK_SECONDS = 10;
const NEAR_SECONDS = 2;
// After the idle timer should have hidden the controls, and after a key that must not pause.
const IDLE_PAST_MS = motion.chromeIdleMs + 1_000;
const SETTLE_MS = 1_000;
// Longer than the runner's polling read of the window.
const WINDOW_READ_MS = 4_000;

const pausedIs = (paused: boolean) => (state: ViewingState) => (state.session.snapshot?.paused === paused ? true : undefined);

// A seek that has landed within NEAR_SECONDS of `seconds`.
const landedNear = (seconds: number) => (state: ViewingState) => {
  const position = positionOf(state);
  const landed = state.seekingTo === undefined && position !== undefined && Math.abs(position - seconds) <= NEAR_SECONDS;
  return landed ? true : undefined;
};

async function drive(context: WireContext, viewing: Viewing, closed: Promise<void>, words: string[]): Promise<void> {
  const { press, readWindow } = context;
  await awaitState(viewing, FIRST_FRAME_MS, "first", (state) => (state.session.firstFrameReady ? true : undefined));
  const wakeAt = await awaitState(viewing, PLAY_MS, "wake", (state) => {
    const position = positionOf(state);
    return position !== undefined && position > WAKE_PAST_SECONDS ? position : undefined;
  });

  // 1 and 2. An arrow wakes the hidden controls, and the play-pause key pauses at once.
  press("DPAD_RIGHT");
  press("MEDIA_PLAY_PAUSE");
  await awaitState(viewing, STEP_MS, "pause", pausedIs(true));
  const pausedAt = positionOf(viewing.state()) ?? Number.NaN;
  words.push(`wake=${pausedAt - wakeAt < NO_SEEK_SECONDS ? "no-seek" : "seeked"}`, "pause=ok");
  readWindow("paused");
  await wait(WINDOW_READ_MS);

  // 3. The arrows seek from the scrubber, where the first step left focus.
  press("DPAD_RIGHT");
  await awaitState(viewing, STEP_MS, "seek", landedNear(pausedAt + SEEK_SECONDS));
  press("DPAD_RIGHT");
  await awaitState(viewing, STEP_MS, "seek-again", landedNear(pausedAt + 2 * SEEK_SECONDS));
  words.push("seek=+20");
  press("DPAD_LEFT");
  await awaitState(viewing, STEP_MS, "seek-back", landedNear(pausedAt + SEEK_SECONDS));
  words.push("back=-10");

  // 4. Down to Play or Pause, and the centre key twice.
  press("DPAD_DOWN");
  press("DPAD_CENTER");
  await awaitState(viewing, STEP_MS, "centre-resume", pausedIs(false));
  words.push("centre=resumed");
  press("DPAD_CENTER");
  await awaitState(viewing, STEP_MS, "centre-pause", pausedIs(true));
  words.push("centre=paused");
  press("MEDIA_PLAY_PAUSE");
  await awaitState(viewing, STEP_MS, "resume", pausedIs(false));
  words.push("resume=ok");

  // 5. Once the controls hide, select shows them without pausing; the next one is Play or Pause's own.
  await wait(IDLE_PAST_MS);
  press("DPAD_CENTER");
  await wait(SETTLE_MS);
  words.push(`centre-wake=${viewing.state().session.snapshot?.paused === false ? "shown" : "toggled"}`);
  press("DPAD_CENTER");
  await awaitState(viewing, STEP_MS, "focused", pausedIs(true));
  words.push("centre-wake=focused");
  press("MEDIA_PLAY_PAUSE");
  await awaitState(viewing, STEP_MS, "resume-again", pausedIs(false));
  readWindow("playing");
  await wait(WINDOW_READ_MS);

  // 6. Back: the screen stops the player, then closes.
  press("BACK");
  const left = await Promise.race([closed.then(() => true), wait(STEP_MS).then(() => false)]);
  if (!left) throw new Ended("back-timeout");
  words.push(`stop=${viewing.state().phase === "playing" ? "still-playing" : "back"}`);
}

export async function run(context: WireContext): Promise<WireOutcome> {
  const gateway = await signIn(context);
  if (isOutcome(gateway)) return gateway;
  const viewing = new Viewing(playbackGatewayOf(gateway), createPlayerEngine(loadPlayerModule()), hostClock, () => undefined);
  const services: PlayerServices = { viewing, PlayerView: loadPlayerView(), serverName: "Wire Server", log: () => undefined };
  const words: string[] = [];
  let outcome = "ok";
  try {
    const itemId = await findEpisode(gateway);
    // Clears the resume point an earlier run left.
    await gateway.setPlayed(itemId, false);
    viewing.play({ itemId, start: startOverChoice() });
    let close: () => void = () => undefined;
    const closed = new Promise<void>((resolve) => {
      close = resolve;
    });
    const shell: ShellApi = { open: () => undefined, route: { kind: "play", id: itemId }, close: () => close() };
    await context.show(
      createElement(
        ShellContext.Provider,
        { value: shell },
        createElement(PlayerServicesContext.Provider, { value: services }, createElement(PlayerScreen)),
      ),
    );
    await drive(context, viewing, closed, words);
  } catch (error) {
    context.seam.add(error);
    outcome = error instanceof Ended ? error.word : codeOf(error);
  } finally {
    context.seam.add(viewing.state());
    // Ends a viewing a failed step left running and waits for the reports; after Back it is already stopped.
    await viewing.stop().catch(() => undefined);
  }
  return { words: [`outcome=${outcome}`, ...words].join(" ") };
}
