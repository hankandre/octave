// T3-11 acceptance items 1, 3 and 5, the React half (docs/specs/T3-11.md, "The JavaScript surface"): the artwork slot
// filled by createNativeArtwork hands the picture view only a session id, an item id, an image type, a tag and the
// drawn width, draws a plain surface2 placeholder until the image arrives, and reports a failed image through the
// slot's onFailed so the card shows its title. A fake view stands in for the native one.
//
// The contract frozen here:
// - createNativeArtwork({ view, session }) from ./native-artwork returns an ArtworkComponent (the T3-08 slot). `view`
//   is the native view component (ComponentType<OctaveArtworkViewProps>), `session` a () => string | undefined getter.
// - With a session it draws a wrapper View carrying the slot's testID, with backgroundColor colors.surface2, and the
//   picture view inside it, last (since T3-39 a preview view that holds only the hash may come before it; its rules
//   are in native-artwork-preview.test.tsx). The picture view receives session, itemId, imageType, tag, width (Math.round of the drawn width),
//   onArtworkState and at most a style: no blurHash, height, testID, URL, header or token.
// - Until an event arrives onFailed is not called. onArtworkState({ nativeEvent: { state: "failed" } }) calls onFailed
//   once; "loaded" calls nothing.
// - With no session it draws the surface2 placeholder and no view, and calls onFailed once.
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, render, screen } from "@testing-library/react-native";
import type { ComponentType, ReactElement } from "react";
import { createElement } from "react";
import { View } from "react-native";
import type { ImageRef } from "@octave/core/src/domain/catalog";
import type { OctaveArtworkViewProps } from "@octave/artwork";
import { ReducedMotionProvider } from "../design/motion";
import { ArtworkProvider } from "../design/rows/artwork";
import { MediaCard } from "../design/rows/media-card";
import type { CardItem } from "../design/rows/media-card";
import { flat } from "../design/test-support/harness";
import { colors, sizes } from "../design/tokens";
import { createNativeArtwork } from "./native-artwork";

const SESSION = "0123456789abcdef0123456789abcdef";
const IMAGE: ImageRef = { itemId: "a1b2c3d4e5f60718293a4b5c6d7e8f90", type: "Primary", tag: "5f3e2d1c0b9a87654321fedcba987654", blurHash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj" };
const FIVE = ["session", "itemId", "imageType", "tag", "width"];

type StateHandler = (event: { nativeEvent: { state: "loaded" | "failed" } }) => void;

const received: Record<string, unknown>[] = [];

function FakeView(props: Record<string, unknown>): ReactElement {
  received.push({ ...props });
  return createElement(View, { testID: "fake-native-view" });
}

const fakeView = FakeView as unknown as ComponentType<OctaveArtworkViewProps>;

function lastProps(): Record<string, unknown> {
  const props = received[received.length - 1];
  expect(props).toBeDefined();
  return props;
}

async function send(state: "loaded" | "failed") {
  const handler = lastProps().onArtworkState as StateHandler;
  expect(typeof handler).toBe("function");
  await act(async () => {
    handler({ nativeEvent: { state } });
  });
}

async function slot(options: { session?: string; width?: number; image?: ImageRef } = {}) {
  const onFailed = jest.fn();
  const Artwork = createNativeArtwork({ view: fakeView, session: () => ("session" in options ? options.session : SESSION) });
  await render(<Artwork image={options.image ?? IMAGE} width={options.width ?? sizes.posterW} height={sizes.posterW * 1.5} onFailed={onFailed} testID="art" />);
  return onFailed;
}

beforeEach(() => {
  received.length = 0;
});

describe("T3-11 item 1: the picture view receives only the five props", () => {
  it("T3-11 item 1: the props the picture view receives are the five, the state handler and at most a style", async () => {
    await slot();
    const props = lastProps();
    const keys = Object.keys(props).filter((key) => key !== "onArtworkState" && key !== "style");
    expect(keys.sort()).toEqual([...FIVE].sort());
    expect(props).toMatchObject({ session: SESSION, itemId: IMAGE.itemId, imageType: "Primary", tag: IMAGE.tag, width: sizes.posterW });
  });

  it("T3-11 item 1: no blurHash, height, testID, URL, header or token reaches the picture view", async () => {
    await slot();
    const props = lastProps();
    for (const key of ["blurHash", "height", "testID", "url", "uri", "source", "src", "headers", "header", "token", "image"]) {
      expect(props).not.toHaveProperty(key);
    }
    expect(JSON.stringify(props)).not.toContain(IMAGE.blurHash);
  });

  it("T3-11 item 1: the slot's testID goes on the wrapper, not on the view", async () => {
    await slot();
    expect(screen.getByTestId("art")).toBeTruthy();
    expect(lastProps().testID).toBeUndefined();
  });
});

describe("T3-11 item 3: the view is asked for the drawn width", () => {
  it("T3-11 item 3: a poster card's slot passes width 248 to the view, and a thumb card's 416", async () => {
    const item: CardItem = { id: "card-1", title: "A title", image: IMAGE };
    const Artwork = createNativeArtwork({ view: fakeView, session: () => SESSION });
    for (const [variant, width] of [["poster", sizes.posterW], ["thumb", sizes.thumbW]] as const) {
      received.length = 0;
      await render(
        <ReducedMotionProvider value>
          <ArtworkProvider component={Artwork}>
            <MediaCard testID="c" item={item} variant={variant} />
          </ArtworkProvider>
        </ReducedMotionProvider>,
      );
      expect({ variant, width: lastProps().width }).toEqual({ variant, width });
    }
    expect(sizes.posterW).toBe(248);
  });

  it("T3-11 item 3: a fractional drawn width is rounded to whole canvas px", async () => {
    await slot({ width: 247.6 });
    expect(lastProps().width).toBe(248);
    received.length = 0;
    await slot({ width: 416.4 });
    expect(lastProps().width).toBe(416);
  });
});

describe("T3-11 item 5: a plain surface until the image arrives, and the title on a failure", () => {
  it("T3-11 item 5: before any event the surface2 placeholder is drawn and onFailed is not called", async () => {
    const onFailed = await slot();
    expect(flat(screen.getByTestId("art")).backgroundColor).toBe(colors.surface2);
    expect(screen.getAllByTestId("fake-native-view").length).toBeGreaterThanOrEqual(1);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("T3-11 item 5: a failed event calls onFailed once", async () => {
    const onFailed = await slot();
    await send("failed");
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it("T3-11 item 5: a loaded event calls nothing", async () => {
    const onFailed = await slot();
    await send("loaded");
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("T3-11 item 5: with no session the placeholder is drawn, no view, and onFailed is called once", async () => {
    const onFailed = await slot({ session: undefined });
    expect(flat(screen.getByTestId("art")).backgroundColor).toBe(colors.surface2);
    expect(screen.queryByTestId("fake-native-view")).toBeNull();
    expect(received).toHaveLength(0);
    expect(onFailed).toHaveBeenCalledTimes(1);
  });

  it("T3-11 item 5: in a card, a failed image shows the title on the missing-image surface", async () => {
    const item: CardItem = { id: "card-2", title: "The card title", image: IMAGE };
    const Artwork = createNativeArtwork({ view: fakeView, session: () => SESSION });
    await render(
      <ReducedMotionProvider value>
        <ArtworkProvider component={Artwork}>
          <MediaCard testID="c" item={item} variant="poster" />
        </ArtworkProvider>
      </ReducedMotionProvider>,
    );
    expect(screen.queryByTestId("c-missing")).toBeNull();
    await send("failed");
    expect(screen.getByTestId("c-missing")).toBeTruthy();
    expect(screen.queryByTestId("fake-native-view")).toBeNull();
  });
});
