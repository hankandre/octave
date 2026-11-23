// T3-39 acceptance items 1, 3 and 6, the React half (docs/specs/T3-39.md, "The JavaScript side"): while a card's
// artwork loads, the slot shows a blurred preview decoded natively from the image's BlurHash, and the picture fades in
// over it on "loaded". A fake view stands in for the native one and records each instance's props in render order.
//
// The contract frozen here (createNativeArtwork from ./native-artwork, as T3-11 froze it, plus):
// - With a session and an image whose blurHash is a non-empty string, the surface2 wrapper (carrying the slot's testID)
//   holds two instances of the view, in this order: a preview view whose props are only blurHash (that exact string)
//   and at most a style; then the picture view with T3-11's five props (session, itemId, imageType, tag, width), the
//   onArtworkState handler and at most a style, and no blurHash.
// - With no blurHash, or "", it draws only the picture view, with no blurHash prop, as T3-11 did.
// - The picture view sits in an element whose style opacity is 0 while a preview is drawn and no "loaded" has come.
//   On "loaded" one Animated.timing(value, { toValue: 1, duration: motion.durSlow, easing: Easing.bezier(...motion.
//   easeInOut), useNativeDriver: true }) starts; under reduced motion (useReducedMotion) the duration is
//   reducedMotion.durSlow. With no preview the picture is at opacity 1 from the start and nothing animates. A new image
//   (a recycled card) starts again at 0.
// - "failed" still calls onFailed, so MediaCard unmounts the slot, preview included, and shows the title.
// - With no session neither view is drawn and onFailed is called once.
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, render, screen, within } from "@testing-library/react-native";
import type { ComponentType, ReactElement } from "react";
import { createElement, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import type { TestInstance } from "test-renderer";
import type { ImageRef } from "@octave/core/src/domain/catalog";
import type { OctaveArtworkViewProps } from "@octave/artwork";
import { ReducedMotionProvider } from "../design/motion";
import { ArtworkProvider } from "../design/rows/artwork";
import { MediaCard } from "../design/rows/media-card";
import type { CardItem } from "../design/rows/media-card";
import { flat } from "../design/test-support/harness";
import { colors, motion, reducedMotion, sizes } from "../design/tokens";
import { createNativeArtwork } from "./native-artwork";

const SESSION = "0123456789abcdef0123456789abcdef";
const HASH = "LEHV6nWB2yk8pyo0adR*.7kCMdnj";
const OTHER_HASH = "diE|rGDNI9tmPpMca0tSO@xFs9R%xuofWARiNGkWWVso";
const HASHED: ImageRef = { itemId: "a1b2c3d4e5f60718293a4b5c6d7e8f90", type: "Primary", tag: "5f3e2d1c0b9a87654321fedcba987654", blurHash: HASH };
const RECYCLED: ImageRef = { itemId: "0f1e2d3c4b5a69788796a5b4c3d2e1f0", type: "Primary", tag: "00112233445566778899aabbccddeeff", blurHash: OTHER_HASH };
const PLAIN: ImageRef = { itemId: HASHED.itemId, type: "Primary", tag: HASHED.tag };
const FIVE = ["session", "itemId", "imageType", "tag", "width"];

type StateHandler = (event: { nativeEvent: { state: "loaded" | "failed" } }) => void;
type Render = { instance: number; props: Record<string, unknown> };

const renders: Render[] = [];
let nextInstance = 0;

function FakeView(props: Record<string, unknown>): ReactElement {
  const instance = useRef(-1);
  if (instance.current < 0) {
    instance.current = nextInstance;
    nextInstance += 1;
  }
  renders.push({ instance: instance.current, props: { ...props } });
  return createElement(View, { testID: "blurHash" in props ? "fake-preview-view" : "fake-picture-view" });
}

const fakeView = FakeView as unknown as ComponentType<OctaveArtworkViewProps>;

/** Each mounted instance's latest props, in the order the instances first rendered. */
function instances(): Record<string, unknown>[] {
  const order: number[] = [];
  const latest = new Map<number, Record<string, unknown>>();
  for (const entry of renders) {
    if (!latest.has(entry.instance)) order.push(entry.instance);
    latest.set(entry.instance, entry.props);
  }
  return order.map((id) => latest.get(id)!);
}

function pictureProps(): Record<string, unknown> {
  const picture = instances().filter((props) => !("blurHash" in props));
  expect(picture.length).toBeGreaterThan(0);
  return picture[picture.length - 1];
}

async function send(state: "loaded" | "failed") {
  const handler = pictureProps().onArtworkState as StateHandler;
  expect(typeof handler).toBe("function");
  await act(async () => {
    handler({ nativeEvent: { state } });
  });
}

/** The opacity of the nearest element above the picture view that sets one; 1 when none does. */
function pictureOpacity(): unknown {
  let node: TestInstance | null = screen.getByTestId("fake-picture-view").parent;
  while (node !== null) {
    const opacity = flat(node).opacity;
    if (opacity !== undefined) return opacity;
    node = node.parent;
  }
  return 1;
}

type TimingConfig = Parameters<typeof Animated.timing>[1];
const spyOnTiming = () => jest.spyOn(Animated, "timing");
let timing: ReturnType<typeof spyOnTiming>;

function timingConfigs(): TimingConfig[] {
  return timing.mock.calls.map((call) => call[1]);
}

function expectEaseInOut(easing: ((value: number) => number) | undefined) {
  expect(typeof easing).toBe("function");
  const expected = Easing.bezier(...motion.easeInOut);
  for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) expect(easing!(t)).toBeCloseTo(expected(t), 3);
}

async function slot(options: { image?: ImageRef; session?: string; reduced?: boolean } = {}) {
  const onFailed = jest.fn();
  const Artwork = createNativeArtwork({ view: fakeView, session: () => ("session" in options ? options.session : SESSION) });
  const element = (image: ImageRef) => (
    <ReducedMotionProvider value={options.reduced ?? false}>
      <Artwork image={image} width={sizes.posterW} height={sizes.posterW * 1.5} onFailed={onFailed} testID="art" />
    </ReducedMotionProvider>
  );
  const view = await render(element(options.image ?? HASHED));
  return { onFailed, rerender: (image: ImageRef) => view.rerender(element(image)) };
}

beforeEach(() => {
  renders.length = 0;
  nextInstance = 0;
  // A started timing jumps its value to toValue, so a test can tell a value that was animated from a fresh one.
  timing = spyOnTiming().mockImplementation((value, config) => {
    const animation = {
      start: (callback?: (result: { finished: boolean }) => void) => {
        (value as Animated.Value).setValue(config.toValue as number);
        callback?.({ finished: true });
      },
      stop: () => undefined,
      reset: () => undefined,
    };
    return animation as unknown as Animated.CompositeAnimation;
  });
});

afterEach(() => {
  timing.mockRestore();
});

describe("T3-39 item 1: a preview view beneath the picture view", () => {
  it("T3-39 item 1: with a hash the view gets two prop sets in order, the preview's blurHash only, then the picture's five", async () => {
    await slot();
    const [preview, picture, ...rest] = instances();
    expect(rest).toEqual([]);
    expect(preview).toBeDefined();
    expect(Object.keys(preview).filter((key) => key !== "style")).toEqual(["blurHash"]);
    expect(preview.blurHash).toBe(HASH);
    expect(picture).toBeDefined();
    expect(Object.keys(picture).filter((key) => key !== "onArtworkState" && key !== "style").sort()).toEqual([...FIVE].sort());
    expect(picture).toMatchObject({ session: SESSION, itemId: HASHED.itemId, imageType: "Primary", tag: HASHED.tag, width: sizes.posterW });
    expect(typeof picture.onArtworkState).toBe("function");
    expect(picture).not.toHaveProperty("blurHash");
  });

  it("T3-39 item 1: the preview is drawn before the picture, so it sits beneath it inside the surface2 wrapper", async () => {
    await slot();
    const views = screen.getAllByTestId(/^fake-(preview|picture)-view$/);
    expect(views.map((view) => view.props.testID)).toEqual(["fake-preview-view", "fake-picture-view"]);
    const wrapper = screen.getByTestId("art");
    expect(flat(wrapper).backgroundColor).toBe(colors.surface2);
    for (const view of views) {
      let node: TestInstance | null = view.parent;
      while (node !== null && node !== wrapper) node = node.parent;
      expect(node).toBe(wrapper);
    }
  });

  it("T3-39 item 1: the preview view gets no session, item id, testID, URL, header or token", async () => {
    await slot();
    const [preview] = instances();
    for (const key of [...FIVE, "onArtworkState", "testID", "height", "url", "uri", "source", "src", "headers", "header", "token", "image"]) {
      expect(preview).not.toHaveProperty(key);
    }
    expect(JSON.stringify(preview)).not.toContain(SESSION);
  });
});

describe("T3-39 item 3: the hash is the drawn image's own, and no hash means the plain surface", () => {
  it("T3-39 item 3: the preview view receives exactly the image ref's hash string", async () => {
    await slot({ image: { ...HASHED, blurHash: OTHER_HASH } });
    const previews = instances().filter((props) => "blurHash" in props);
    expect(previews.map((props) => props.blurHash)).toEqual([OTHER_HASH]);
  });

  it("T3-39 item 3: a ref with no blurHash draws one view with no blurHash prop, on the surface2 wrapper", async () => {
    await slot({ image: PLAIN });
    expect(instances()).toHaveLength(1);
    expect(pictureProps()).not.toHaveProperty("blurHash");
    expect(screen.queryByTestId("fake-preview-view")).toBeNull();
    expect(flat(screen.getByTestId("art")).backgroundColor).toBe(colors.surface2);
  });

  it("T3-39 item 3: a ref whose blurHash is empty draws one view with no blurHash prop, on the surface2 wrapper", async () => {
    await slot({ image: { ...HASHED, blurHash: "" } });
    expect(instances()).toHaveLength(1);
    expect(pictureProps()).not.toHaveProperty("blurHash");
    expect(screen.queryByTestId("fake-preview-view")).toBeNull();
    expect(flat(screen.getByTestId("art")).backgroundColor).toBe(colors.surface2);
  });

  it("T3-39 item 3: with a hash but no session neither view is drawn and onFailed is called once", async () => {
    const { onFailed } = await slot({ session: undefined });
    expect(renders).toHaveLength(0);
    expect(flat(screen.getByTestId("art")).backgroundColor).toBe(colors.surface2);
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it("T3-39 item 3: in a card with a hashed ref, a failed image shows the title and leaves no view mounted", async () => {
    const item: CardItem = { id: "card-1", title: "The card title", image: HASHED };
    const Artwork = createNativeArtwork({ view: fakeView, session: () => SESSION });
    await render(
      <ReducedMotionProvider value={false}>
        <ArtworkProvider component={Artwork}>
          <MediaCard testID="c" item={item} variant="poster" />
        </ArtworkProvider>
      </ReducedMotionProvider>,
    );
    expect(screen.getByTestId("fake-preview-view")).toBeTruthy();
    expect(screen.queryByTestId("c-missing")).toBeNull();
    await send("failed");
    expect(screen.getByTestId("c-missing")).toBeTruthy();
    expect(within(screen.getByTestId("c-missing")).getByText("The card title")).toBeTruthy();
    expect(screen.queryByTestId("fake-preview-view")).toBeNull();
    expect(screen.queryByTestId("fake-picture-view")).toBeNull();
  });
});

describe("T3-39 item 6: the picture fades in over the preview on the motion tokens", () => {
  it("T3-39 item 6: with a preview the picture starts at opacity 0 and nothing animates before loaded", async () => {
    await slot();
    expect(pictureOpacity()).toBe(0);
    expect(timing).not.toHaveBeenCalled();
  });

  it("T3-39 item 6: on loaded one timing to 1 runs over durSlow with easeInOut on the native driver", async () => {
    await slot();
    await send("loaded");
    expect(timing).toHaveBeenCalledTimes(1);
    const [config] = timingConfigs();
    expect(config).toMatchObject({ toValue: 1, duration: motion.durSlow, useNativeDriver: true });
    expectEaseInOut(config.easing);
    expect(timing.mock.calls[0][0]).toBeInstanceOf(Animated.Value);
  });

  it("T3-39 item 6: under reduced motion the fade lasts reducedMotion.durSlow, opacity only", async () => {
    await slot({ reduced: true });
    expect(pictureOpacity()).toBe(0);
    await send("loaded");
    expect(timing).toHaveBeenCalledTimes(1);
    const [config] = timingConfigs();
    expect(config).toMatchObject({ toValue: 1, duration: reducedMotion.durSlow, useNativeDriver: true });
    expect(reducedMotion.durSlow).toBe(120);
  });

  it("T3-39 item 6: with no hash the picture is at opacity 1 and nothing animates, before or after loaded", async () => {
    await slot({ image: PLAIN });
    expect(pictureOpacity()).toBe(1);
    await send("loaded");
    expect(timing).not.toHaveBeenCalled();
    expect(pictureOpacity()).toBe(1);
  });

  it("T3-39 item 6: a recycled card with a new image starts again at 0 and fades again on its own loaded", async () => {
    const { rerender } = await slot();
    await send("loaded");
    expect(timing).toHaveBeenCalledTimes(1);
    await rerender(RECYCLED);
    expect(pictureProps()).toMatchObject({ itemId: RECYCLED.itemId, tag: RECYCLED.tag });
    expect(pictureOpacity()).toBe(0);
    expect(timing).toHaveBeenCalledTimes(1);
    await send("loaded");
    expect(timing).toHaveBeenCalledTimes(2);
    expect(timingConfigs()[1]).toMatchObject({ toValue: 1, duration: motion.durSlow, useNativeDriver: true });
  });

  it("T3-39 item 6: a failed event starts no fade", async () => {
    const { onFailed } = await slot();
    await send("failed");
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(timing).not.toHaveBeenCalled();
  });
});
