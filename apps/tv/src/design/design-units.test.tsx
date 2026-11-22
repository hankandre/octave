// T3-06: the implementer's own tests for the pure design modules (not frozen). `.test.tsx` so Jest's testMatch finds it.
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Dimensions, PixelRatio, processColor } from "react-native";
import { colors, artDefaults, type } from "./tokens";

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

function loadScale(windowWidth: number) {
  jest.spyOn(Dimensions, "get").mockReturnValue({ width: windowWidth, height: 540, scale: 1, fontScale: 1 });
  jest.spyOn(PixelRatio, "roundToNearestPixel").mockImplementation((value: number) => value);
  return require("./scale") as typeof import("./scale");
}

describe("px", () => {
  it("halves canvas px on a 960 dp window", () => {
    expect(loadScale(960).px(248)).toBe(124);
  });

  it("is 1:1 on a 1920 dp window", () => {
    expect(loadScale(1920).px(248)).toBe(248);
  });
});

describe("textStyle", () => {
  it("sets the face, size, line height and tracking from the token", () => {
    const { px } = loadScale(1920);
    const { textStyle } = require("./text") as typeof import("./text");
    const hero = textStyle("typeHero");
    expect(hero.fontFamily).toBe("AtkinsonHyperlegibleNext");
    expect(hero.fontSize).toBe(px(type.typeHero.size));
    expect(hero.lineHeight).toBe(px(type.typeHero.size * type.typeHero.lineHeight));
    expect(hero.letterSpacing).toBe(px(type.typeHero.size * type.typeHero.tracking));
    expect(textStyle("typeCode").fontFamily).toBe("AtkinsonHyperlegibleMono");
  });

  it("maps weight 650 to 600 plus the wght axis, and other weights to fontWeight", () => {
    loadScale(1920);
    const { textStyle } = require("./text") as typeof import("./text");
    expect(textStyle("typeTitle")).toMatchObject({ fontWeight: "600", fontVariationSettings: "'wght' 650" });
    expect(textStyle("typeDialogTitle")).toMatchObject({ fontWeight: "600", fontVariationSettings: "'wght' 650" });
    expect(textStyle("typeBody").fontWeight).toBe("400");
    expect(textStyle("typeHero").fontWeight).toBe("700");
    expect(textStyle("typeBody")).not.toHaveProperty("fontVariationSettings");
  });
});

describe("colour tokens", () => {
  it("each parses as a React Native colour", () => {
    for (const [name, value] of [...Object.entries(colors), ...Object.entries(artDefaults)]) {
      if (processColor(value) === null) throw new Error(`${name} is not a colour React Native parses`);
    }
  });
});
