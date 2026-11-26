// The player chrome's key and idle rules (T8-04 D4), pure: no React, no timer and no key source. The screen feeds it
// inputs, runs the command it returns and owns the one timer that fires at `idleAt`.
//
// Every select is read from the focused Pressable's `onPress` (`holderPress`, `scrubberPress` or the control's own). The
// hardware `select` is only `activity`, which can restart the idle timer and never commands anything.
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

export type ChromeCommand = "show-scrubber" | "show-play" | "seek-back" | "seek-forward" | "toggle" | "pause" | "resume";

export type ChromeResult = { state: ChromeState; command?: ChromeCommand };

export const hiddenChrome: ChromeState = { shown: false, zone: "none" };

/** A shown chrome with its idle timer started over, or stopped while paused or held. */
function restarted(state: ChromeState, { at, paused, hold }: InputContext): ChromeState {
  return { shown: true, zone: state.zone, idleAt: paused || hold ? undefined : at + motion.chromeIdleMs };
}

function arrow(state: ChromeState, input: InputContext, seek?: ChromeCommand): ChromeResult {
  const next = restarted(state, input);
  if (!state.shown) return { state: next, command: "show-scrubber" };
  return { state: next, command: state.zone === "scrubber" ? seek : undefined };
}

/** A key that pauses or resumes. Pausing a hidden chrome shows it; resuming leaves it hidden. */
function transport(state: ChromeState, input: InputContext, command: ChromeCommand, pauses: boolean): ChromeResult {
  if (!state.shown && !pauses) return { state, command };
  return { state: restarted(state, input), command };
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
    case "play":
      return transport(state, input, "resume", false);
    case "pause":
      return transport(state, input, "pause", true);
    case "holderPress":
      return state.shown ? { state: restarted(state, input) } : { state: restarted(state, input), command: "show-play" };
    case "activity":
    case "changed":
      return { state: state.shown ? restarted(state, input) : state };
    case "focus":
      return { state: { ...state, zone: input.zone } };
    case "idle":
      return { state: state.shown && !input.paused && !input.hold ? hiddenChrome : state };
  }
}
