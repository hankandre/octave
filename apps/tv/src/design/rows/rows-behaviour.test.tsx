// T3-08 implementer's own tests (not frozen): the card's F4 focus look, select, the failure reset, the played glyph,
// row memory identity, the label and the geometry against hand-computed values.
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react-native";
import { View } from "react-native";
import { ReducedMotionProvider } from "../motion";
import { px } from "../scale";
import { colors, motion, sizes } from "../tokens";
import { flat, hasTransform, scaleOf } from "../test-support/harness";
import { pressSelect } from "../test-support/select-key";
import { ArtworkProvider } from "./artwork";
import { MediaCard } from "./media-card";
import { ROW_DRAW_DISTANCE, THUMB_ROW_DRAW_DISTANCE, cardCentre, cardGap, cardWidth, drawDistanceFor, rowInsetStart } from "./row-geometry";
import { useRowMemory } from "./row-memory";
import { FixtureArtwork, artworkCalls, cardPlain, cardPlayed, resetArtworkCalls } from "./test-support/fixtures";

const event = { nativeEvent: {} };

function card(reduced: boolean, extra: Partial<Parameters<typeof MediaCard>[0]> = {}, item = cardPlain) {
  return (
    <ReducedMotionProvider value={reduced}>
      <ArtworkProvider component={FixtureArtwork}>
        <MediaCard testID="c" item={item} variant="poster" {...extra} />
      </ArtworkProvider>
    </ReducedMotionProvider>
  );
}

describe("T3-08 card focus look", () => {
  it("lifts at once with the ring and the text1 title, and drops back on blur", async () => {
    await render(card(false));
    expect(hasTransform(screen.getByTestId("c-art"))).toBe(false);
    expect(screen.queryByTestId("c-focus-ring")).toBeNull();
    expect(flat(screen.getByTestId("c-title")).color).toBe(colors.text2);
    await fireEvent(screen.getByTestId("c"), "focus", event);
    expect(scaleOf(screen.getByTestId("c-art"))).toBe(motion.lift);
    expect(screen.getByTestId("c-focus-ring")).toBeTruthy();
    expect(flat(screen.getByTestId("c-art")).boxShadow).toBeDefined();
    expect(flat(screen.getByTestId("c-title")).color).toBe(colors.text1);
    await fireEvent(screen.getByTestId("c"), "blur", event);
    expect(hasTransform(screen.getByTestId("c-art"))).toBe(false);
    expect(screen.queryByTestId("c-focus-ring")).toBeNull();
  });

  it("does not scale under reduced motion, and the ring still shows", async () => {
    await render(card(true));
    await fireEvent(screen.getByTestId("c"), "focus", event);
    expect(hasTransform(screen.getByTestId("c-art"))).toBe(false);
    expect(screen.getByTestId("c-focus-ring")).toBeTruthy();
  });

  it("select calls onPress", async () => {
    const onPress = jest.fn();
    await render(card(true, { onPress }));
    await pressSelect(screen.getByTestId("c"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("labels the card with the title and subtitle, or the given label", async () => {
    const view = await render(card(true));
    expect(screen.getByTestId("c").props.accessibilityLabel).toBe(`${cardPlain.title}, ${cardPlain.subtitle}`);
    await view.rerender(card(true, {}, { ...cardPlain, accessibilityLabel: "Given label" }));
    expect(screen.getByTestId("c").props.accessibilityLabel).toBe("Given label");
  });

  it("forgets a failure when the item changes", async () => {
    resetArtworkCalls();
    const view = await render(card(true));
    await act(async () => {
      (artworkCalls.at(-1) as { onFailed: () => void }).onFailed();
    });
    expect(screen.getByTestId("c-missing")).toBeTruthy();
    await view.rerender(card(true, {}, { ...cardPlain, id: "another" }));
    expect(screen.queryByTestId("c-missing")).toBeNull();
    expect(screen.getByTestId("c-artwork")).toBeTruthy();
  });

  it("draws the played glyph inside the mark when the provider gives one", async () => {
    const Glyph = ({ size, color }: { size: number; color: string }) => <View testID="glyph" style={{ width: size, backgroundColor: color }} />;
    await render(
      <ReducedMotionProvider value>
        <ArtworkProvider playedIcon={Glyph}>
          <MediaCard testID="c" item={cardPlayed} variant="thumb" />
        </ArtworkProvider>
      </ReducedMotionProvider>,
    );
    expect(screen.getByTestId("glyph")).toBeTruthy();
    expect(screen.getByTestId("c-played").queryAll((node) => node.props.testID === "glyph").length).toBeGreaterThan(0);
  });
});

describe("T3-08 row memory and geometry", () => {
  it("useRowMemory keeps one object across re-renders and makes a new one on remount", async () => {
    const first = await renderHook(() => useRowMemory());
    const before = first.result.current;
    await first.rerender({});
    expect(first.result.current).toBe(before);
    const second = await renderHook(() => useRowMemory());
    expect(second.result.current).not.toBe(before);
  });

  it("cardCentre matches hand-computed values", () => {
    expect(cardCentre("poster", 0, 0)).toBe(rowInsetStart + sizes.posterW / 2);
    expect(cardCentre("thumb", 2, 100)).toBe(rowInsetStart + 2 * (sizes.thumbW + cardGap) + sizes.thumbW / 2 - 100);
    expect(cardWidth("poster")).toBe(sizes.posterW);
    expect(px(rowInsetStart)).toBeGreaterThan(0);
  });

  it("a poster row draws ROW_DRAW_DISTANCE dp ahead and a thumb row THUMB_ROW_DRAW_DISTANCE, at least as far", () => {
    expect(drawDistanceFor("poster")).toBe(ROW_DRAW_DISTANCE);
    expect(drawDistanceFor("thumb")).toBe(THUMB_ROW_DRAW_DISTANCE);
    expect(THUMB_ROW_DRAW_DISTANCE).toBeGreaterThanOrEqual(ROW_DRAW_DISTANCE);
    expect(THUMB_ROW_DRAW_DISTANCE).toBeLessThanOrEqual(243);
  });
});
