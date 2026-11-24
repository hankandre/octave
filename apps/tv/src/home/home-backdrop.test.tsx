// T5-03 item 6: the ambient backdrop follows the focused card after a 300 ms pause, and swaps without a fade under reduced
// motion. Fake timers carry the dwell; `Animated.timing` is replaced by a recorder, so a test says when a fade ends.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, screen } from "@testing-library/react-native";
import { Animated } from "react-native";
import type { ImageRef } from "@octave/core/src/domain/catalog";
import { motion, reducedMotion } from "../design/tokens";
import { cwEpisode, cwFilm, flush, focusOn, heroFilm, makeRig, nextEpisode, renderHome, rowCard } from "./test-support/home-doubles";

jest.mock("@shopify/flash-list", () => require("../design/rows/test-support/flash-list-double"));

type Finish = (result: { finished: boolean }) => void;
let finishers: Finish[] = [];
let timing: jest.SpiedFunction<typeof Animated.timing>;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
  finishers = [];
  timing = jest.spyOn(Animated, "timing").mockImplementation(((_value: unknown, _config: unknown) => ({
    start: (done?: Finish) => {
      if (done) finishers.push(done);
    },
    stop: () => undefined,
    reset: () => undefined,
  })) as never);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/** The image each backdrop layer draws, the newest last. */
const layers = (): ImageRef[] => screen.queryAllByTestId(/^home-backdrop-artwork/).map((element) => element.props.image as ImageRef);
const advance = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};
const fades = () => timing.mock.calls.filter(([, config]) => ([motion.durSlow, reducedMotion.durSlow] as number[]).includes((config as { duration: number }).duration));

describe("T5-03 item 6: the ambient backdrop", () => {
  it("T5-03 item 6: when Home is ready the backdrop shows the hero's backdrop at once, with no wait", async () => {
    await renderHome(makeRig());
    expect(layers()).toEqual([heroFilm.backdrop]);
  });

  it("T5-03 item 6: a card focus keeps the hero's art at 299 ms and shows the card's at 300 ms", async () => {
    await renderHome(makeRig());
    await focusOn(rowCard("continue-watching", 0));
    await advance(299);
    expect(layers().at(-1)).toEqual(heroFilm.backdrop);
    await advance(1);
    expect(layers().at(-1)).toEqual(cwEpisode.backdrop);
  });

  it("T5-03 item 6: two focus changes 200 ms apart settle on the second, 300 ms after it, and the first is never shown", async () => {
    await renderHome(makeRig());
    await focusOn(rowCard("continue-watching", 0));
    await advance(200);
    await focusOn(rowCard("continue-watching", 2));
    await advance(100);
    expect(layers().at(-1)).toEqual(heroFilm.backdrop);
    await advance(199);
    expect(layers().at(-1)).toEqual(heroFilm.backdrop);
    await advance(1);
    expect(layers().at(-1)).toEqual(nextEpisode.backdrop);
    expect(layers().some((image) => image.tag === cwEpisode.backdrop?.tag)).toBe(false);
  });

  it("T5-03 item 6: a card with no backdrop leaves no art, not the last title's picture", async () => {
    await renderHome(makeRig());
    await focusOn(rowCard("continue-watching", 1));
    expect(cwFilm.backdrop).toBeUndefined();
    expect(cwFilm.parentBackdrop).toBeUndefined();
    await advance(300);
    await flush();
    expect(layers()).toEqual([]);
  });

  it("T5-03 item 6: a hero button taking focus brings the hero's art back after the pause", async () => {
    await renderHome(makeRig());
    await focusOn(rowCard("continue-watching", 0));
    await advance(300);
    expect(layers().at(-1)).toEqual(cwEpisode.backdrop);
    await focusOn("home-hero-primary");
    await advance(299);
    expect(layers().at(-1)).toEqual(cwEpisode.backdrop);
    await advance(1);
    expect(layers().at(-1)).toEqual(heroFilm.backdrop);
  });

  it("T5-03 item 6: with motion on, a settled swap starts one fade of motion.durSlow on the native driver and drops the old layer when it ends", async () => {
    await renderHome(makeRig());
    await advance(1000);
    timing.mockClear();
    finishers = [];
    await focusOn(rowCard("continue-watching", 0));
    await advance(300);
    const started = fades();
    expect(started).toHaveLength(1);
    expect(started[0]?.[1]).toMatchObject({ duration: motion.durSlow, useNativeDriver: true });
    expect(layers()).toEqual([heroFilm.backdrop, cwEpisode.backdrop]);
    await act(async () => {
      for (const done of finishers) done({ finished: true });
    });
    expect(layers()).toEqual([cwEpisode.backdrop]);
  });

  it("T5-03 item 6: under reduced motion the old art is gone in the same render and no fade is started", async () => {
    await renderHome(makeRig(), { reduced: true });
    await advance(1000);
    await focusOn(rowCard("continue-watching", 0));
    await advance(299);
    expect(layers()).toEqual([heroFilm.backdrop]);
    await advance(1);
    expect(layers()).toEqual([cwEpisode.backdrop]);
    expect(fades()).toHaveLength(0);
  });
});
