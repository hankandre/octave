// T3-08 item 6: poster and thumb cards show the title, the progress bar and the played mark from fixture data, and a
// missing image shows the title on a plain surface. Artwork comes through a slot that takes only an ImageRef and a
// drawn size, so no URL, header or token ever reaches a view. Sizes are canvas px through px().
import { beforeEach, describe, expect, it } from "@jest/globals";
import { act, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import type { TestInstance } from "test-renderer";
import { ReducedMotionProvider } from "../motion";
import { px } from "../scale";
import { sizes } from "../tokens";
import { flat } from "../test-support/harness";
import { ArtworkProvider } from "./artwork";
import { MediaCard } from "./media-card";
import type { CardItem } from "./media-card";
import { FIXTURE_PROGRESS, FixtureArtwork, artworkCalls, cardNoImage, cardPlain, cardPlayed, cardProgress, resetArtworkCalls } from "./test-support/fixtures";

type Variant = "poster" | "thumb";

const DRAWN: Record<Variant, { w: number; h: number }> = {
  poster: { w: sizes.posterW, h: sizes.posterW * 1.5 },
  thumb: { w: sizes.thumbW, h: (sizes.thumbW * 9) / 16 },
};

beforeEach(() => {
  resetArtworkCalls();
});

function card(item: CardItem, variant: Variant, provider: boolean = true): ReactElement {
  const inner = <MediaCard testID="c" item={item} variant={variant} />;
  return (
    <ReducedMotionProvider value>
      {provider ? <ArtworkProvider component={FixtureArtwork}>{inner}</ArtworkProvider> : inner}
    </ReducedMotionProvider>
  );
}

function textOf(element: TestInstance): string {
  return element.children.map((child) => (typeof child === "string" ? child : textOf(child))).join("");
}

function focusableIds(): unknown[] {
  return screen.container.queryAll((instance) => instance.props.focusable === true).map((instance) => instance.props.testID);
}

for (const variant of ["poster", "thumb"] as const) {
  describe(`T3-08 item 6: a ${variant} card`, () => {
    it(`T3-08 item 6: ${variant} shows the title and the subtitle`, async () => {
      await render(card(cardPlain, variant));
      expect(textOf(screen.getByTestId("c-title"))).toBe(cardPlain.title);
      expect(textOf(screen.getByTestId("c-subtitle"))).toBe(cardPlain.subtitle);
    });

    it(`T3-08 item 6: ${variant} art frame is the drawn size in dp`, async () => {
      await render(card(cardPlain, variant));
      const frame = flat(screen.getByTestId("c-art"));
      expect(frame.width).toBe(px(DRAWN[variant].w));
      expect(frame.height).toBe(px(DRAWN[variant].h));
    });

    it(`T3-08 item 6: ${variant} with progress shows a fill at that percentage`, async () => {
      await render(card(cardProgress, variant));
      expect(screen.getByTestId("c-progress")).toBeTruthy();
      expect(flat(screen.getByTestId("c-progress-fill")).width).toBe(`${FIXTURE_PROGRESS * 100}%`);
      expect(screen.queryByTestId("c-played")).toBeNull();
    });

    it(`T3-08 item 6: ${variant} played shows the played mark and no progress bar, even with progress`, async () => {
      await render(card({ ...cardProgress, played: true }, variant));
      expect(screen.getByTestId("c-played")).toBeTruthy();
      expect(screen.queryByTestId("c-progress")).toBeNull();
      expect(screen.queryByTestId("c-progress-fill")).toBeNull();
    });

    it(`T3-08 item 6: ${variant} unplayed with no progress shows neither mark`, async () => {
      await render(card(cardPlain, variant));
      expect(screen.queryByTestId("c-played")).toBeNull();
      expect(screen.queryByTestId("c-progress")).toBeNull();
    });

    it(`T3-08 item 6: ${variant} with progress 0 or 1 and not played shows no progress bar`, async () => {
      const view = await render(card({ ...cardPlain, progress: 0 }, variant));
      expect(screen.queryByTestId("c-progress")).toBeNull();
      await view.rerender(card({ ...cardPlain, progress: 1 }, variant));
      expect(screen.queryByTestId("c-progress")).toBeNull();
    });

    it(`T3-08 item 6: ${variant} gives the artwork slot exactly image, width, height, onFailed and testID, in canvas px`, async () => {
      await render(card(cardPlain, variant));
      expect(screen.getByTestId("c-artwork")).toBeTruthy();
      expect(screen.queryByTestId("c-missing")).toBeNull();
      const props = artworkCalls.at(-1) as Record<string, unknown>;
      expect(Object.keys(props).sort()).toEqual(["height", "image", "onFailed", "testID", "width"]);
      expect(props.image).toEqual(cardPlain.image);
      expect(props.width).toBe(DRAWN[variant].w);
      expect(props.height).toBe(DRAWN[variant].h);
      expect(props.testID).toBe("c-artwork");
      expect(typeof props.onFailed).toBe("function");
      for (const name of ["uri", "url", "source", "headers", "token"]) {
        expect(name in props).toBe(false);
        expect(screen.getByTestId("c-artwork").props[name]).toBeUndefined();
      }
    });

    it(`T3-08 item 6: ${variant} shows the title on a plain surface once the artwork reports onFailed`, async () => {
      await render(card(cardPlain, variant));
      await act(async () => {
        (artworkCalls.at(-1) as { onFailed: () => void }).onFailed();
      });
      expect(textOf(screen.getByTestId("c-missing"))).toContain(cardPlain.title);
    });

    it(`T3-08 item 6: ${variant} with no image shows c-missing with the title and never renders the provider's component`, async () => {
      await render(card(cardNoImage, variant));
      expect(textOf(screen.getByTestId("c-missing"))).toContain(cardNoImage.title);
      expect(screen.queryByTestId("c-artwork")).toBeNull();
      expect(artworkCalls).toEqual([]);
    });

    it(`T3-08 item 6: ${variant} with no provider shows c-missing with the title`, async () => {
      await render(card(cardPlain, variant, false));
      expect(textOf(screen.getByTestId("c-missing"))).toContain(cardPlain.title);
      expect(screen.queryByTestId("c-artwork")).toBeNull();
    });

    it(`T3-08 item 6: ${variant} has one focusable element, the card, and no mark or missing surface takes focus`, async () => {
      for (const item of [cardProgress, cardPlayed, cardNoImage]) {
        const view = await render(card(item, variant));
        expect(focusableIds()).toEqual(["c"]);
        for (const id of ["c-played", "c-progress", "c-missing"]) {
          const element = screen.queryByTestId(id);
          if (element !== null) expect(element.props.focusable).not.toBe(true);
        }
        await view.unmount();
      }
    });
  });
}
