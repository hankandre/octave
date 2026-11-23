// T3-11 review fix: a failure the native view reports for an image the slot no longer shows does not fail the slot.
// The view is keyed by its five props, so a new tag for the same item remounts it, and the old view's late "failed"
// event is ignored while the new view's own failure still reaches onFailed.
import { beforeEach, expect, it, jest } from "@jest/globals";
import { act, render } from "@testing-library/react-native";
import type { ComponentType, ReactElement } from "react";
import { createElement, useEffect } from "react";
import { View } from "react-native";
import type { ImageRef } from "@octave/core/src/domain/catalog";
import type { OctaveArtworkViewProps } from "@octave/artwork";
import { sizes } from "../design/tokens";
import { createNativeArtwork } from "./native-artwork";

type StateHandler = (event: { nativeEvent: { state: "loaded" | "failed" } }) => void;

const SESSION = "0123456789abcdef0123456789abcdef";
const OLD: ImageRef = { itemId: "a1b2c3d4e5f60718293a4b5c6d7e8f90", type: "Primary", tag: "5f3e2d1c0b9a87654321fedcba987654" };
const NEW: ImageRef = { ...OLD, tag: "0000000000000000ffffffffffffffff" };

let mounts = 0;
const handlers: { tag: unknown; handler: StateHandler }[] = [];

function FakeView(props: Record<string, unknown>): ReactElement {
  useEffect(() => {
    mounts += 1;
  }, []);
  handlers.push({ tag: props.tag, handler: props.onArtworkState as StateHandler });
  return createElement(View);
}

const fakeView = FakeView as unknown as ComponentType<OctaveArtworkViewProps>;

function handlerFor(tag: string): StateHandler {
  const found = handlers.filter((entry) => entry.tag === tag).pop();
  expect(found).toBeDefined();
  return found!.handler;
}

beforeEach(() => {
  mounts = 0;
  handlers.length = 0;
});

it("a late failure for the old tag does not fail the slot after the item's tag changed", async () => {
  const onFailed = jest.fn();
  const Artwork = createNativeArtwork({ view: fakeView, session: () => SESSION });
  const view = await render(<Artwork image={OLD} width={sizes.posterW} height={sizes.posterW * 1.5} onFailed={onFailed} />);
  const stale = handlerFor(OLD.tag);

  await view.rerender(<Artwork image={NEW} width={sizes.posterW} height={sizes.posterW * 1.5} onFailed={onFailed} />);
  expect(mounts).toBe(2);

  await act(async () => {
    stale({ nativeEvent: { state: "failed" } });
  });
  expect(onFailed).not.toHaveBeenCalled();

  await act(async () => {
    handlerFor(NEW.tag)({ nativeEvent: { state: "failed" } });
  });
  expect(onFailed).toHaveBeenCalledTimes(1);
});
