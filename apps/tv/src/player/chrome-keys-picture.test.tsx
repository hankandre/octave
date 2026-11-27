// T8-27 items 1 and 2: the pure key rules from a hidden chrome (spec D1's table), with the T8-27 ruling on check issue 1.
//
// Testing contract (the implementer builds to it). `chromeState` returns `{ state, command?, focus? }`, `focus` being
// "scrubber" or "play" and set exactly when the input shows a hidden chrome. A chrome that shows already has `state.zone`
// at the focus target, "scrubber" for an arrow and "controls" for a pause; the later focus event confirms or corrects it.
import { describe, expect, it } from "@jest/globals";
import { motion } from "../design/tokens";
import { chromeState } from "./chrome-keys";

type State = Parameters<typeof chromeState>[0];
type Input = Parameters<typeof chromeState>[1];
type KeyType = Exclude<Input["type"], "focus">;

const AT = 1000;
const hidden: State = { shown: false, zone: "none" };

const input = (type: KeyType, over: { paused?: boolean } = {}): Input => ({
  type,
  at: AT,
  paused: false,
  hold: false,
  ...over,
});

describe("T8-27 item 1: select from the picture", () => {
  it("T8-27 item 1: while playing, the holder's press toggles and shows the chrome with focus for Play or Pause", () => {
    const result = chromeState(hidden, input("holderPress"));

    expect(result.command).toBe("toggle");
    expect(result.focus).toBe("play");
    expect(result.state.shown).toBe(true);
    expect(result.state.zone).toBe("controls");
  });

  it("T8-27 item 1: while paused, the holder's press resumes and leaves the chrome hidden", () => {
    const result = chromeState(hidden, input("holderPress", { paused: true }));

    expect(result.command).toBe("toggle");
    expect(result.focus).toBeUndefined();
    expect(result.state.shown).toBe(false);
  });

  it.each([
    ["playPause", "toggle"],
    ["pause", "pause"],
  ] as const)("T8-27 item 1: %s from the picture shows the chrome with focus for Play or Pause", (key, command) => {
    const result = chromeState(hidden, input(key));

    expect(result.command).toBe(command);
    expect(result.focus).toBe("play");
    expect(result.state.zone).toBe("controls");
  });
});

describe("T8-27 item 2: the arrows from the picture", () => {
  it.each([
    ["left", "seek-back"],
    ["right", "seek-forward"],
    ["up", undefined],
    ["down", undefined],
    ["heldArrow", undefined],
  ] as const)("T8-27 item 2: %s shows the chrome on the scrubber with the command %s", (key, command) => {
    const result = chromeState(hidden, input(key));

    expect(result.command).toBe(command);
    expect(result.focus).toBe("scrubber");
    expect(result.state.shown).toBe(true);
    expect(result.state.zone).toBe("scrubber");
    expect(result.state.idleAt).toBe(AT + motion.chromeIdleMs);
  });

  it.each([
    ["left", "seek-back"],
    ["right", "seek-forward"],
  ] as const)("T8-27 item 2: a second %s before any focus event seeks again and moves focus nowhere new", (key, command) => {
    const first = chromeState(hidden, input(key));
    const second = chromeState(first.state, input(key));

    expect(second.command).toBe(command);
    expect(second.focus).toBeUndefined();
  });
});
