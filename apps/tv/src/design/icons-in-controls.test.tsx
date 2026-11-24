// T3-34 item 4: every icon-taking control and the played mark draw a real Tabler glyph, at the size and colour the control
// sets. T3-06's frozen TestIcon stays the IconComponent contract double; this file runs the same controls with `iconOf`.
import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { Dialog } from "./controls/dialog";
import { EmptyState } from "./controls/empty-state";
import { IconButton } from "./controls/icon-button";
import { Notice } from "./controls/notice";
import { Toast } from "./controls/toast";
import { ICON_FAMILY, iconOf } from "./icon";
import { MediaCard } from "./rows/media-card";
import { cardPlain, cardPlayed } from "./rows/test-support/fixtures";
import { px } from "./scale";
import { renderWith } from "./test-support/harness";
import { railIcons } from "../shell/rail-icons";
import type { RailIconName } from "../shell/rail-entries";
import { colors, sizes, space } from "./tokens";

const SEARCH = String.fromCodePoint(0xeb1c);
const CHECK = String.fromCodePoint(0xea5e);
const noop = () => {};

type Drawn = { size: unknown; color: unknown; family: unknown };

function drawn(glyph: { props: { style?: unknown } }): Drawn {
  const style = (StyleSheet.flatten(glyph.props.style as never) ?? {}) as Record<string, unknown>;
  return { size: style.fontSize, color: style.color, family: style.fontFamily };
}

function expectGlyph(found: Drawn, size: number, color: string) {
  expect(found).toEqual({ size, color, family: ICON_FAMILY });
}

describe("T3-34 item 4: controls draw Tabler glyphs", () => {
  it("T3-34 item 4: IconButton draws its glyph at space6 in text1, and in text3 when disabled", async () => {
    const view = await renderWith(<IconButton testID="ib" icon={iconOf("search")} accessibilityLabel="Search" onPress={noop} />, true);
    expectGlyph(drawn(screen.getByText(SEARCH)), px(space.space6), colors.text1);
    await view.rerender(
      <IconButton testID="ib" icon={iconOf("search")} accessibilityLabel="Search" onPress={noop} disabled />,
    );
    expectGlyph(drawn(screen.getByText(SEARCH)), px(space.space6), colors.text3);
  });

  it("T3-34 item 4: Toast draws its glyph at space6 in text2, and in danger on an error", async () => {
    const view = await renderWith(<Toast testID="t" visible kind="info" message="Saved." icon={iconOf("search")} onDismiss={noop} />, true);
    expectGlyph(drawn(screen.getByText(SEARCH)), px(space.space6), colors.text2);
    await view.rerender(<Toast testID="t" visible kind="error" message="Failed." icon={iconOf("search")} onDismiss={noop} />);
    expectGlyph(drawn(screen.getByText(SEARCH)), px(space.space6), colors.danger);
  });

  it("T3-34 item 4: Dialog draws its glyph at emptyIcon in text2", async () => {
    await renderWith(<Dialog testID="d" visible title="Title" icon={iconOf("search")} actions={[{ id: "ok", label: "OK", onPress: noop }]} onDismiss={noop} />, true);
    expectGlyph(drawn(screen.getByText(SEARCH)), px(sizes.emptyIcon), colors.text2);
  });

  it("T3-34 item 4: Notice draws its glyph at emptyIcon in the notice colour", async () => {
    await renderWith(<Notice testID="n" title="Title" message="Message" icon={iconOf("search")} actions={[]} />, true);
    expectGlyph(drawn(screen.getByText(SEARCH)), px(sizes.emptyIcon), colors.notice);
  });

  it("T3-34 item 4: EmptyState draws its glyph at emptyIcon in text3", async () => {
    await renderWith(<EmptyState testID="e" title="Title" message="Message" icon={iconOf("search")} />, true);
    expectGlyph(drawn(screen.getByText(SEARCH)), px(sizes.emptyIcon), colors.text3);
  });
});

describe("T3-34 item 4: the played mark", () => {
  it("T3-34 item 4: a played card with no ArtworkProvider holds the check inside c-played at markDisc minus two space1, in text1", async () => {
    await renderWith(<MediaCard testID="c" item={cardPlayed} variant="poster" />, true);
    const glyph = within(screen.getByTestId("c-played")).getByText(CHECK);
    expectGlyph(drawn(glyph), px(sizes.markDisc - 2 * space.space1), colors.text1);
  });

  it("T3-34 item 4: an unplayed card holds no glyph", async () => {
    await renderWith(<MediaCard testID="c" item={cardPlain} variant="poster" />, true);
    expect(screen.queryByTestId("c-played")).toBeNull();
    expect(screen.queryByText(CHECK)).toBeNull();
  });
});

describe("T3-34 item 4: the side rail's glyphs", () => {
  it("T3-34 item 4: railIcons gives a component for every RailIconName", () => {
    const names: RailIconName[] = ["search", "home", "movies", "tvshows", "boxsets", "settings", "account"];
    for (const name of names) {
      expect([`a glyph for ${name}`, railIcons[name] !== undefined]).toEqual([`a glyph for ${name}`, true]);
    }
  });

  it("T3-34 item 4: the rail names the owner's Tabler glyphs", () => {
    expect(railIcons.search).toBe(iconOf("search"));
    expect(railIcons.home).toBe(iconOf("home"));
    expect(railIcons.movies).toBe(iconOf("movie"));
    expect(railIcons.tvshows).toBe(iconOf("device-tv"));
    expect(railIcons.boxsets).toBe(iconOf("stack-2"));
    expect(railIcons.settings).toBe(iconOf("settings"));
    expect(railIcons.account).toBe(iconOf("user"));
  });
});
