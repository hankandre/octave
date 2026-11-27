// Wire test player-transport (T8-04, D13; its steps since T8-27 D5): the real player screen over the native view, playing a 60 s episode from the
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
// A seek asked for while playing aims 10 s from where the picture was when the key arrived, which the last one-second
// state event and the key's trip through adb leave up to about this far past the position read before the press.
// Playing only moves forward, so the aim falls short of it only by rounding.
const PLAYING_AHEAD_SECONDS = 3;
const PLAYING_BEHIND_SECONDS = 0.5;
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

// A seek asked for while playing, aimed from PLAYING_BEHIND_SECONDS before `seconds` to PLAYING_AHEAD_SECONDS after it,
// once the position reads within NEAR_SECONDS of the aim. Playing alone never sets a seek target, and a seek the engine
// refused clears its target with the position left where it was, so neither can pass.
function playingSeekLanded(seconds: number) {
  let asked: number | undefined;
  return (state: ViewingState) => {
    if (state.seekingTo !== undefined) {
      asked = state.seekingTo;
      return undefined;
    }
    if (asked === undefined) return undefined;
    const aimed = asked - seconds >= -PLAYING_BEHIND_SECONDS && asked - seconds <= PLAYING_AHEAD_SECONDS;
    const position = positionOf(state);
    const landed = position !== undefined && Math.abs(position - asked) <= NEAR_SECONDS;
    return aimed && landed ? true : undefined;
  };
}

// While paused, sends Right and then Left and says whether the position held. On Play or Pause they only move focus to
// Forward and back; on the scrubber each seeks, and the two cancel out, so every state in between is watched.
async function arrowsHoldStill({ press }: WireContext, viewing: Viewing): Promise<boolean> {
  const from = positionOf(viewing.state()) ?? Number.NaN;
  let moved = false;
  const unsubscribe = viewing.subscribe(() => {
    const state = viewing.state();
    const away = Math.abs((positionOf(state) ?? Number.NaN) - from) > NEAR_SECONDS;
    if (state.seekingTo !== undefined || away) moved = true;
  });
  press("DPAD_RIGHT");
  press("DPAD_LEFT");
  await wait(SETTLE_MS);
  unsubscribe();
  return !moved;
}

// Presses an arrow with only the picture showing, while playing, and waits for its 10 s step to land.
async function pictureSeek({ press }: WireContext, viewing: Viewing, key: "DPAD_LEFT" | "DPAD_RIGHT", step: string): Promise<void> {
  const from = positionOf(viewing.state()) ?? Number.NaN;
  const delta = key === "DPAD_LEFT" ? -SEEK_SECONDS : SEEK_SECONDS;
  press(key);
  await awaitState(viewing, STEP_MS, step, playingSeekLanded(from + delta));
}

async function drive(context: WireContext, viewing: Viewing, closed: Promise<void>, words: string[]): Promise<void> {
  const { press, readWindow } = context;
  await awaitState(viewing, FIRST_FRAME_MS, "first", (state) => (state.session.firstFrameReady ? true : undefined));
  const wakeAt = await awaitState(viewing, PLAY_MS, "wake", (state) => {
    const position = positionOf(state);
    return position !== undefined && position > WAKE_PAST_SECONDS ? position : undefined;
  });

  // 1 and 2. Up wakes the hidden controls on the scrubber without seeking, and the play-pause key pauses at once.
  press("DPAD_UP");
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
  words.push(`down=${(await arrowsHoldStill(context, viewing)) ? "play-pause" : "elsewhere"}`);
  press("MEDIA_PLAY_PAUSE");
  await awaitState(viewing, STEP_MS, "resume", pausedIs(false));
  words.push("resume=ok");

  // 5. Once the controls hide, select pauses and leaves focus on Play or Pause, whose own press resumes (T8-27).
  await wait(IDLE_PAST_MS);
  press("DPAD_CENTER");
  await awaitState(viewing, STEP_MS, "picture-select", pausedIs(true));
  words.push("picture-select=paused");
  words.push(`picture-select=${(await arrowsHoldStill(context, viewing)) ? "play-pause" : "elsewhere"}`);
  press("DPAD_CENTER");
  await awaitState(viewing, STEP_MS, "picture-select-resume", pausedIs(false));
  words.push("picture-select=resumed");

  // 6. Once the controls hide, Left steps back 10 s and leaves focus on the scrubber, where Right steps on while paused.
  await wait(IDLE_PAST_MS);
  await pictureSeek(context, viewing, "DPAD_LEFT", "picture-left");
  words.push("picture-left=back");
  press("MEDIA_PLAY_PAUSE");
  await awaitState(viewing, STEP_MS, "picture-left-pause", pausedIs(true));
  const leftAt = positionOf(viewing.state()) ?? Number.NaN;
  press("DPAD_RIGHT");
  await awaitState(viewing, STEP_MS, "picture-left-scrubber", landedNear(leftAt + SEEK_SECONDS));
  words.push("picture-left=scrubber");
  press("MEDIA_PLAY_PAUSE");
  await awaitState(viewing, STEP_MS, "picture-left-resume", pausedIs(false));
  // Down takes focus off the scrubber to the control row, so if the controls failed to hide, the next Right only moves
  // focus there and step 7 times out instead of seeking from the scrubber.
  press("DPAD_DOWN");
  readWindow("playing");
  await wait(WINDOW_READ_MS);

  // 7. Once the controls hide, Right steps on 10 s. The window read's wait is already most of the idle time.
  await wait(Math.max(0, IDLE_PAST_MS - WINDOW_READ_MS));
  await pictureSeek(context, viewing, "DPAD_RIGHT", "picture-right");
  words.push("picture-right=forward");

  // 8. Back: the screen stops the player, then closes.
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
