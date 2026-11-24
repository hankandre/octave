// T3-34 item 3: one typed map gives each icon name its glyph behind IconComponent, and a name with no glyph fails.
import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { ICON_FAMILY, glyphs, iconOf, type IconName } from "./icon";
import { colors } from "./tokens";
import { cmapRanges, cssCodepoint, inRanges } from "./test-support/tabler-font";

const namesOf = () => Object.keys(glyphs) as IconName[];

describe("T3-34 item 3: the glyph map", () => {
  it("T3-34 item 3: holds the eight names a screen uses", () => {
    expect(namesOf().sort()).toEqual(["check", "device-tv", "home", "movie", "search", "settings", "stack-2", "user"]);
  });

  it("T3-34 item 3: every entry equals the content of its rule in the weight-300 stylesheet", () => {
    for (const name of namesOf()) {
      expect(cssCodepoint(name), `.ti-${name}:before in tabler-icons-300.css`).toBe(glyphs[name]);
    }
  });

  it("T3-34 item 3: every codepoint is in the weight-300 font's cmap", () => {
    const ranges = cmapRanges();
    for (const name of namesOf()) {
      expect(inRanges(ranges, glyphs[name]), `${name} is in the cmap`).toBe(true);
    }
  });

  it("T3-34 item 3: a name with no glyph throws", () => {
    expect(() => iconOf("nope" as IconName)).toThrow('no glyph for icon "nope"');
  });

  it("T3-34 item 3: iconOf draws the glyph as one hidden Text in the family, at the size and colour it is given", async () => {
    const Check = iconOf("check");
    await render(<Check size={20} color={colors.text1} />);
    const glyph = screen.getByText(String.fromCodePoint(0xea5e));
    const style = StyleSheet.flatten(glyph.props.style) as Record<string, unknown>;
    expect(ICON_FAMILY).toBe("TablerIcons");
    expect(style.fontFamily).toBe(ICON_FAMILY);
    expect(style.fontSize).toBe(20);
    expect(style.lineHeight).toBe(20);
    expect(style.color).toBe(colors.text1);
    expect(glyph.props.allowFontScaling).toBe(false);
    expect(glyph.props.accessible).toBe(false);
    expect(glyph.props.importantForAccessibility).toBe("no");
  });

  it("T3-34 item 3: iconOf returns one stable component per name", () => {
    expect(iconOf("check")).toBe(iconOf("check"));
    expect(iconOf("check")).not.toBe(iconOf("search"));
  });
});
