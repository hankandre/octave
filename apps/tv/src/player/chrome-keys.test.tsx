// T8-04 items 1 and 3: the pure key and idle rules (spec D4), every row of its table the reducer decides. A control row
// button's own select is the component's, and player-chrome.test.tsx holds it.
//
// Testing contract (the implementer builds to it). `./chrome-keys` exports
//   chromeState(state: ChromeState, input: ChromeInput): { state: ChromeState; command?: ChromeCommand; focus?: "scrubber" | "play" }
// - ChromeState is { shown: boolean; zone: "top" | "scrubber" | "controls" | "none"; idleAt?: number }.
// - Every input carries `at` (ms), `paused` (the picture's, before any command runs) and `hold` (true while something
//   keeps the chrome up: a sheet, a focused prompt, loading or a failure), plus a `type`:
//   "up", "down", "left", "right", "playPause", "play", "pause" (a key's hardware event);
//   "activity" (the hardware select and longSelect, and any other key that only counts as a key);
//   "holderPress", "scrubberPress" (that Pressable's onPress);
//   "focus" with `zone` (what onFocus and onBlur reported last);
//   "changed" (`paused` or `hold` changed); "idle" (the screen's one timer fired).
// - ChromeCommand is one of "seek-back", "seek-forward", "toggle", "pause", "resume".
// - `focus` is where the screen moves focus, set exactly when the input shows a hidden chrome (T8-27 D1).
// - `idleAt` is when the chrome is to hide, and is absent while it is not to.
import { describe, expect, it } from "@jest/globals";
import { motion } from "../design/tokens";
import { chromeState } from "./chrome-keys";

type State = Parameters<typeof chromeState>[0];
type Input = Parameters<typeof chromeState>[1];
type Zone = State["zone"];
type KeyType = Exclude<Input["type"], "focus">;

const IDLE = motion.chromeIdleMs;
const hidden: State = { shown: false, zone: "none" };
const shownOn = (zone: Zone, idleAt = IDLE): State => ({ shown: true, zone, idleAt });

const input = (type: KeyType, at: number, over: { paused?: boolean; hold?: boolean } = {}): Input => ({
  type,
  at,
  paused: false,
  hold: false,
  ...over,
});
const focusOn = (zone: Zone, at: number): Input => ({ type: "focus", zone, at, paused: false, hold: false });

const ARROWS: KeyType[] = ["up", "down", "left", "right"];
const ZONES: Zone[] = ["top", "scrubber", "controls"];

describe("T8-04 item 1: the key rules from the picture", () => {
  const HIDDEN_ARROW_COMMANDS: Record<string, string | undefined> = {
    up: undefined,
    down: undefined,
    left: "seek-back",
    right: "seek-forward",
  };

  it.each(ARROWS)("T8-04 item 1: hidden, %s shows the chrome with focus for the scrubber; Left and Right seek", (arrow) => {
    const result = chromeState(hidden, input(arrow, 1000));

    expect(result.focus).toBe("scrubber");
    expect(result.command).toBe(HIDDEN_ARROW_COMMANDS[arrow]);
    expect(result.state.shown).toBe(true);
    expect(result.state.idleAt).toBe(1000 + IDLE);
  });

  it("T8-04 item 1: hidden, the holder's press pauses and shows the chrome with focus for Play or Pause", () => {
    const result = chromeState(hidden, input("holderPress", 1000));

    expect(result.command).toBe("toggle");
    expect(result.focus).toBe("play");
    expect(result.state.shown).toBe(true);
  });

  it("T8-04 item 1: the hardware select is never a command, hidden or shown, and shows nothing", () => {
    const fromPicture = chromeState(hidden, input("activity", 1000));
    expect(fromPicture.command).toBeUndefined();
    expect(fromPicture.state.shown).toBe(false);

    for (const zone of ZONES) expect(chromeState(shownOn(zone), input("activity", 1000)).command).toBeUndefined();
  });

  it("T8-04 item 1: playPause toggles in every state, and pausing from the picture shows the chrome", () => {
    const fromPicture = chromeState(hidden, input("playPause", 1000));
    expect(fromPicture.command).toBe("toggle");
    expect(fromPicture.state.shown).toBe(true);

    for (const zone of ZONES) expect(chromeState(shownOn(zone), input("playPause", 1000)).command).toBe("toggle");
  });

  it("T8-04 item 1: pause pauses and shows the chrome, and play resumes", () => {
    const paused = chromeState(hidden, input("pause", 1000));
    expect(paused.command).toBe("pause");
    expect(paused.state.shown).toBe(true);

    expect(chromeState(shownOn("controls"), input("play", 1000, { paused: true })).command).toBe("resume");
  });

  it("T8-04 item 1: with the scrubber focused, left and right seek and its press toggles", () => {
    expect(chromeState(shownOn("scrubber"), input("left", 1000)).command).toBe("seek-back");
    expect(chromeState(shownOn("scrubber"), input("right", 1000)).command).toBe("seek-forward");
    expect(chromeState(shownOn("scrubber"), input("scrubberPress", 1000)).command).toBe("toggle");
  });

  it("T8-04 item 1: off the scrubber, the arrows command nothing, also right after focus left it", () => {
    for (const zone of ["top", "controls"] as const) {
      const moved = chromeState(shownOn("scrubber"), focusOn(zone, 1000));
      expect(moved.state.zone).toBe(zone);
      for (const arrow of ARROWS) expect(chromeState(moved.state, input(arrow, 1000)).command).toBeUndefined();
    }
  });
});

describe("T8-04 item 3: the idle rules", () => {
  it.each([...ARROWS, "activity"] as KeyType[])("T8-04 item 3: shown and playing, %s starts the 3 s again", (key) => {
    const result = chromeState(shownOn("controls"), input(key, 2000));

    expect(result.state.shown).toBe(true);
    expect(result.state.idleAt).toBe(2000 + IDLE);
  });

  it("T8-04 item 3: when the timer fires the chrome hides, with a control focused or not", () => {
    for (const zone of [...ZONES, "none"] as Zone[]) {
      const result = chromeState(shownOn(zone), input("idle", IDLE));
      expect(result.state.shown).toBe(false);
      expect(result.state.idleAt).toBeUndefined();
    }
  });

  it.each([
    ["while paused", { paused: true }],
    ["with hold set", { hold: true }],
  ])("T8-04 item 3: %s the chrome never hides, and hides 3 s after that ends", (_name, condition) => {
    const held = chromeState(shownOn("controls"), input("changed", 1000, condition));
    expect(held.state.idleAt).toBeUndefined();
    expect(chromeState(held.state, input("down", 2000, condition)).state.idleAt).toBeUndefined();
    expect(chromeState(held.state, input("idle", 60_000, condition)).state.shown).toBe(true);

    const released = chromeState(held.state, input("changed", 70_000));
    expect(released.state.shown).toBe(true);
    expect(released.state.idleAt).toBe(70_000 + IDLE);
    expect(chromeState(released.state, input("idle", 70_000 + IDLE)).state.shown).toBe(false);
  });
});
