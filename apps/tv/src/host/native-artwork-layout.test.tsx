// T3-42 acceptance items 2 and 3 (docs/specs/T3-42.md, "Test plan"): the artwork slot hands the picture view its drawn
// width as drawnWidth, and passes no prop that React Native's layout would read, so only the frame sizes each view.
// A fake view stands in for the native one and records the props of every render.
//
// The names React Native reads are taken from the installed package, so an upgrade that adds one is covered: the Android
// base view config's validAttributes (named by platform, because jest's default platform may not be Android) joined with
// the style attributes. These JavaScript sets stand in for the C++ list that actually reads the raw props
// (ReactCommon/react/renderer/components/view/propsConversions.h and YogaStylableProps.cpp); every Yoga name there is a
// style attribute, so the union covers it.
//
// jest runs no Yoga and no native view, so that a view's bounds equal its frame is checked on a device.
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react-native";
import type { ComponentType, ReactElement } from "react";
import { createElement, useRef } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import type { ImageRef } from "@octave/core/src/domain/catalog";
import type { OctaveArtworkViewProps } from "@octave/artwork";
import { ReducedMotionProvider } from "../design/motion";
import { ArtworkProvider } from "../design/rows/artwork";
import { MediaCard } from "../design/rows/media-card";
import type { CardItem } from "../design/rows/media-card";
import { createNativeArtwork } from "./native-artwork";

const SESSION = "0123456789abcdef0123456789abcdef";
const IMAGE: ImageRef = { itemId: "a1b2c3d4e5f60718293a4b5c6d7e8f90", type: "Primary", tag: "5f3e2d1c0b9a87654321fedcba987654", blurHash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj" };
const CANVAS_WIDTH = 1920;

// The package publishes no types for its Libraries paths, so the shapes read here are named by hand.
type AttributeNames = Record<string, unknown>;
const baseViewConfig = jest.requireActual<{ default: { validAttributes: AttributeNames } }>("react-native/Libraries/NativeComponent/BaseViewConfig.android");
const styleAttributes = jest.requireActual<{ default: AttributeNames }>("react-native/Libraries/Components/View/ReactNativeStyleAttributes");
const READ_BY_REACT_NATIVE = new Set([...Object.keys(baseViewConfig.default.validAttributes), ...Object.keys(styleAttributes.default)]);

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
  return createElement(View);
}

const fakeView = FakeView as unknown as ComponentType<OctaveArtworkViewProps>;
const Artwork = createNativeArtwork({ view: fakeView, session: () => SESSION });

/** The latest props of the picture view: the instance that is not given a BlurHash. */
function pictureProps(): Record<string, unknown> | undefined {
  return renders.filter((entry) => !("blurHash" in entry.props)).at(-1)?.props;
}

async function slot(width: number) {
  await render(
    <ReducedMotionProvider value>
      <Artwork image={IMAGE} width={width} height={width} onFailed={() => undefined} testID="art" />
    </ReducedMotionProvider>,
  );
}

async function card(variant: "poster" | "thumb") {
  const item: CardItem = { id: "card-1", title: "A title", image: IMAGE };
  await render(
    <ReducedMotionProvider value>
      <ArtworkProvider component={Artwork}>
        <MediaCard testID="c" item={item} variant={variant} />
      </ArtworkProvider>
    </ReducedMotionProvider>,
  );
}

beforeEach(() => {
  renders.length = 0;
  nextInstance = 0;
});

describe("T3-42 item 2: the picture view is told its drawn width as drawnWidth", () => {
  it.each([
    ["poster", 248],
    ["thumb", 416],
  ] as const)("T3-42 item 2: a %s card's picture view receives drawnWidth %i", async (variant, expected) => {
    await card(variant);
    expect(pictureProps()?.drawnWidth).toBe(expected);
  });

  it.each([
    [247.6, 248],
    [CANVAS_WIDTH, CANVAS_WIDTH],
  ])("T3-42 item 2: a slot %d wide gives the picture view drawnWidth %i", async (width, expected) => {
    await slot(width);
    expect(pictureProps()?.drawnWidth).toBe(expected);
  });
});

describe("T3-42 item 3: no prop given to a view is a name React Native's layout reads", () => {
  it("T3-42 item 3: neither the preview nor the picture view receives a prop React Native reads, style apart", async () => {
    expect([...READ_BY_REACT_NATIVE]).toEqual(expect.arrayContaining(["width", "height", "flex"]));
    await slot(416);
    expect(new Set(renders.map((entry) => entry.instance)).size).toBe(2);
    const clashes = renders.flatMap((entry) => Object.keys(entry.props).filter((key) => key !== "style" && READ_BY_REACT_NATIVE.has(key)));
    expect([...new Set(clashes)]).toEqual([]);
  });

  it("T3-42 item 3: neither view's style sets a width or a height, so only the frame sizes it", async () => {
    await slot(416);
    expect(new Set(renders.map((entry) => entry.instance)).size).toBe(2);
    for (const entry of renders) {
      const style: ViewStyle = StyleSheet.flatten(entry.props.style as StyleProp<ViewStyle>) ?? {};
      expect(style).not.toHaveProperty("width");
      expect(style).not.toHaveProperty("height");
    }
  });
});
