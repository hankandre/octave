// The T3-39 fixture Home (docs/specs/T3-39.md, "Files to touch", spec check issues 1 and 3): eight rows of twelve
// distinct ids, a distinct valid BlurHash on every card but every third, and a recording view that draws a preview
// view (blurHash and style only) as given, with no handler and no recorded state.
import { describe, expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react-native";
import type { ComponentType, ReactElement } from "react";
import { createElement } from "react";
import { View } from "react-native";
import type { OctaveArtworkViewProps } from "@octave/artwork";
import { FIXTURE_ROWS, recordingView } from "./artwork-fixture-home";
import { FIXTURE_ITEM_IDS, MISSING_IMAGE_ID, fixtureBlurHash } from "./artwork-fixture-ids";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";

const decode83 = (text: string) => [...text].reduce((value, char) => value * 83 + ALPHABET.indexOf(char), 0);

describe("T3-39 fixture Home", () => {
  it("has eight rows of twelve distinct ids, the fourth the missing one", () => {
    expect(FIXTURE_ROWS).toHaveLength(8);
    for (const row of FIXTURE_ROWS) expect(row.items).toHaveLength(12);
    expect(FIXTURE_ROWS.map((row) => row.variant)).toEqual(["poster", "thumb", "poster", "thumb", "poster", "thumb", "poster", "thumb"]);
    expect(new Set(FIXTURE_ITEM_IDS).size).toBe(96);
    expect(FIXTURE_ITEM_IDS[3]).toBe(MISSING_IMAGE_ID);
    expect(FIXTURE_ROWS.flatMap((row) => row.items.map((item) => item.id))).toEqual(FIXTURE_ITEM_IDS);
  });

  it("gives every card but every third its own valid 5x4 BlurHash", () => {
    const cards = FIXTURE_ROWS.flatMap((row) => row.items);
    const hashes = cards.map((item) => item.image?.blurHash).filter((hash): hash is string => hash !== undefined);
    expect(hashes).toHaveLength(64);
    expect(new Set(hashes).size).toBe(64);
    cards.forEach((item, index) => expect(item.image?.blurHash).toBe(index % 3 === 2 ? undefined : fixtureBlurHash(index)));
    for (const hash of hashes) {
      expect(hash).toHaveLength(44);
      expect([...hash].every((char) => ALPHABET.includes(char))).toBe(true);
      const flag = decode83(hash[0]);
      expect({ numX: (flag % 9) + 1, numY: Math.floor(flag / 9) + 1 }).toEqual({ numX: 5, numY: 4 });
      expect(decode83(hash.slice(2, 6))).toBeLessThanOrEqual(0xffffff);
      for (let at = 6; at < 44; at += 2) expect(decode83(hash.slice(at, at + 2))).toBeLessThanOrEqual(6858);
    }
  });
});

describe("T3-39 recordingView", () => {
  it("records a preview view's props and draws it with no handler and no state", async () => {
    const drawn: Record<string, unknown>[] = [];
    function FakeView(props: Record<string, unknown>): ReactElement {
      drawn.push({ ...props });
      return createElement(View);
    }
    const props = jest.fn<(props: Record<string, unknown>) => void>();
    const state = jest.fn<(itemId: string, payload: unknown) => void>();
    const Recording = recordingView(FakeView as unknown as ComponentType<OctaveArtworkViewProps>, { props, state });
    const hash = fixtureBlurHash(0);
    await render(<Recording blurHash={hash} style={{ flex: 1 }} />);
    expect(props).toHaveBeenCalledWith({ blurHash: hash, style: { flex: 1 } });
    expect(drawn).toHaveLength(1);
    expect(Object.keys(drawn[0]).sort()).toEqual(["blurHash", "style"]);
    expect(drawn[0]).not.toHaveProperty("onArtworkState");
    expect(state).not.toHaveBeenCalled();
  });
});
