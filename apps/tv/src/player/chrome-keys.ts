// The player chrome's key and idle rules (T8-04 D4), pure: no React, no timer and no key source. The screen feeds it
// inputs, runs the command it returns and owns the one timer that fires at `idleAt`.
//
// Every select is read from the focused Pressable's `onPress` (`holderPress`, `scrubberPress` or the control's own). The
// hardware `select` is only `activity`, which can restart the idle timer and never commands anything.
//
// From the picture (T8-27): select is the play-pause key, Left and Right step 10 s, and every arrow shows the chrome on
// the scrubber. A held arrow only shows it (T8-05 gives it its meaning). Skip and Play now, when built, go before the
// play-pause rule in `holderPress`.
import { motion } from "../design/tokens";

export type ChromeZone = "top" | "scrubber" | "controls" | "none";

export type ChromeState = {
  shown: boolean;
  /** Where focus is, as the zones' onFocus and onBlur reported last. */
  zone: ChromeZone;
  /** When the chrome is to hide (ms). Absent while it is not to. */
  idleAt?: number;
};

export type ChromeKey =
  | "up"
  | "down"
  | "left"
  | "right"
  /** An arrow held past react-native-tvos's 300 ms: it shows the chrome like the arrow and never seeks (T8-05). */
  | "heldArrow"
  | "playPause"
  | "play"
  | "pause"
  | "activity"
  | "holderPress"
  | "scrubberPress"
  /** `paused` or `hold` changed. */
  | "changed"
  /** The screen's timer fired. */
  | "idle";

type InputContext = {
  at: number;
  /** The picture's, before any command runs. */
  paused: boolean;
  /** True while something keeps the chrome up: a sheet, a focused prompt, loading or a failure. */
  hold: boolean;
};

export type ChromeInput = InputContext & ({ type: ChromeKey } | { type: "focus"; zone: ChromeZone });

export type ChromeCommand = "seek-back" | "seek-forward" | "toggle" | "pause" | "resume";

/** Where focus goes when an input shows a hidden chrome: the scrubber, or Play or Pause. */
export type ChromeFocus = "scrubber" | "play";

/** `focus` is set exactly when the input shows a hidden chrome (T8-27 D1). */
export type ChromeResult = { state: ChromeState; command?: ChromeCommand; focus?: ChromeFocus };

export const hiddenChrome: ChromeState = { shown: false, zone: "none" };

/** A shown chrome with its idle timer started over, or stopped while paused or held. */
function restarted(state: ChromeState, { at, paused, hold }: InputContext): ChromeState {
  return { shown: true, zone: state.zone, idleAt: paused || hold ? undefined : at + motion.chromeIdleMs };
}

/**
 * A shown chrome from a hidden one. Its zone is already the focus target, so a second key before the focus event lands
 * acts there; the focus event then confirms or corrects it.
 */
function shownOn(state: ChromeState, input: InputContext, focus: ChromeFocus): ChromeState {
  return { ...restarted(state, input), zone: focus === "scrubber" ? "scrubber" : "controls" };
}

/** An arrow. From the picture it shows the chrome on the scrubber, and Left and Right also step (T8-27). */
function arrow(state: ChromeState, input: InputContext, seek?: ChromeCommand): ChromeResult {
  if (!state.shown) return { state: shownOn(state, input, "scrubber"), command: seek, focus: "scrubber" };
  return { state: restarted(state, input), command: state.zone === "scrubber" ? seek : undefined };
}

/** A key that pauses or resumes. Pausing a hidden chrome shows it on Play or Pause; resuming leaves it hidden. */
function transport(state: ChromeState, input: InputContext, command: ChromeCommand, pauses: boolean): ChromeResult {
  if (state.shown) return { state: restarted(state, input), command };
  if (!pauses) return { state, command };
  return { state: shownOn(state, input, "play"), command, focus: "play" };
}

export function chromeState(state: ChromeState, input: ChromeInput): ChromeResult {
  switch (input.type) {
    case "up":
    case "down":
    case "heldArrow":
      return arrow(state, input);
    case "left":
      return arrow(state, input, "seek-back");
    case "right":
      return arrow(state, input, "seek-forward");
    case "playPause":
    case "scrubberPress":
      return transport(state, input, "toggle", !input.paused);
    case "holderPress":
      // The holder takes no focus while the chrome shows, so only a hidden chrome's select is a command.
      if (state.shown) return { state: restarted(state, input) };
      return transport(state, input, "toggle", !input.paused);
    case "play":
      return transport(state, input, "resume", false);
    case "pause":
      return transport(state, input, "pause", true);
    case "activity":
    case "changed":
      return { state: state.shown ? restarted(state, input) : state };
    case "focus":
      return { state: { ...state, zone: input.zone } };
    case "idle":
      return { state: state.shown && !input.paused && !input.hold ? hiddenChrome : state };
  }
}
