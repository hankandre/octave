// Runs the pure key and idle rules (chrome-keys.ts) for the screen: it feeds them the remote's keys and the controls'
// presses, runs the command they return and owns the one idle timer.
import { useCallback, useEffect, useRef, useState } from "react";
import { chromeState, hiddenChrome, type ChromeCommand, type ChromeInput, type ChromeKey, type ChromeZone } from "./chrome-keys";
import type { PlayerServices } from "./player-services";
import { useRemoteKeys } from "./use-remote-keys";

const SEEK_STEP_SECONDS = 10;

type Viewing = PlayerServices["viewing"];

export function runChromeCommand(viewing: Viewing, command: ChromeCommand): void {
  switch (command) {
    case "seek-back":
      viewing.seekBy(-SEEK_STEP_SECONDS);
      break;
    case "seek-forward":
      viewing.seekBy(SEEK_STEP_SECONDS);
      break;
    case "toggle":
      viewing.togglePaused();
      break;
    case "pause":
      viewing.setPaused(true);
      break;
    case "resume":
      viewing.setPaused(false);
      break;
    case "show-scrubber":
    case "show-play":
      break;
  }
}

type Options = {
  viewing: Viewing;
  paused: boolean;
  /** Something keeps the chrome up. */
  hold: boolean;
  /** False while another layer is up: the key rules do not run, and the chrome starts hidden again. */
  active: boolean;
};

export type PlayerChromeState = {
  shown: boolean;
  /** Where focus goes when the chrome shows. */
  target: "scrubber" | "play";
  /** A press of the focus holder or the scrubber. */
  press(type: "holderPress" | "scrubberPress"): void;
  focused(zone: ChromeZone): void;
};

export function usePlayerChrome({ viewing, paused, hold, active }: Options): PlayerChromeState {
  const rules = useRef(hiddenChrome);
  const [state, setState] = useState(hiddenChrome);
  const [target, setTarget] = useState<PlayerChromeState["target"]>("scrubber");
  const held = useRef(hold);
  held.current = hold;

  const apply = useCallback(
    (input: { type: Exclude<ChromeInput["type"], "focus"> } | { type: "focus"; zone: ChromeZone }) => {
      const wasShown = rules.current.shown;
      const result = chromeState(rules.current, {
        ...input,
        at: Date.now(),
        paused: viewing.state().session.snapshot?.paused === true,
        hold: held.current,
      });
      rules.current = result.state;
      setState(result.state);
      if (!wasShown && result.state.shown) setTarget(result.command === "show-scrubber" ? "scrubber" : "play");
      if (result.command !== undefined) runChromeCommand(viewing, result.command);
    },
    [viewing],
  );

  useRemoteKeys(
    useCallback(
      (key: ChromeKey) => {
        if (active) apply({ type: key });
      },
      [active, apply],
    ),
  );

  useEffect(() => {
    apply({ type: "changed" });
  }, [paused, hold, apply]);

  useEffect(() => {
    if (active) return;
    rules.current = hiddenChrome;
    setState(hiddenChrome);
  }, [active]);

  useEffect(() => {
    if (state.idleAt === undefined) return undefined;
    const timer = setTimeout(() => apply({ type: "idle" }), state.idleAt - Date.now());
    return () => clearTimeout(timer);
  }, [state.idleAt, apply]);

  const press = useCallback((type: "holderPress" | "scrubberPress") => apply({ type }), [apply]);
  const focused = useCallback((zone: ChromeZone) => apply({ type: "focus", zone }), [apply]);

  return { shown: active && state.shown, target, press, focused };
}
