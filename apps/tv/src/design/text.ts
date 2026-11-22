// The only builder of text styles: family, size, line height, tracking and weight from a type token (DESIGN.md §4).
import type { TextStyle } from "react-native";
import { px } from "./scale";
import { faces, type, type TypeToken } from "./tokens";

export type TypeName = keyof typeof type;

/** Weight 650 is not a CSS keyword weight: it is `600` plus the variable font's `wght` axis at 650. */
const VARIABLE_WEIGHT = 650;

export function textStyle(name: TypeName): TextStyle {
  const token: TypeToken = type[name];
  return {
    fontFamily: faces[token.face],
    fontSize: px(token.size),
    lineHeight: px(token.size * token.lineHeight),
    ...(token.tracking !== undefined ? { letterSpacing: px(token.size * token.tracking) } : {}),
    ...(token.weight === VARIABLE_WEIGHT
      ? { fontWeight: "600" as const, fontVariationSettings: `'wght' ${token.weight}` }
      : { fontWeight: String(token.weight) as TextStyle["fontWeight"] }),
  };
}
