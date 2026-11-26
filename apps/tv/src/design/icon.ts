// The icon slot. A control takes an IconComponent: a component that draws itself at the size and colour the control gives
// it. The icons are Tabler's weight-300 font, bundled through expo-font (app.config.ts, T3-34). This file holds the only
// codepoints; a screen names an icon with `iconOf("<tabler name>")`. A new screen adds its entry to `glyphs`.
import { createElement, type ComponentType } from "react";
import { Text } from "react-native";

export type IconComponent = ComponentType<{ size: number; color: string }>;

export const ICON_FAMILY = "TablerIcons";

/** Tabler's icon name to its codepoint in tabler-icons-300.ttf. */
export const glyphs = {
  check: 0xea5e,
  search: 0xeb1c,
  home: 0xeac1,
  movie: 0xeafa,
  "device-tv": 0xea8d,
  "stack-2": 0xeef7,
  settings: 0xeb20,
  user: 0xeb4d,
  "arrow-left": 0xea19,
  "player-pause": 0xed45,
  "player-play": 0xed46,
  "rewind-backward-10": 0xfaba,
  "rewind-forward-10": 0xfac2,
} as const;

export type IconName = keyof typeof glyphs;

const cache = new Map<IconName, IconComponent>();

export function iconOf(name: IconName): IconComponent {
  const cached = cache.get(name);
  if (cached) return cached;
  const codepoint: number | undefined = glyphs[name];
  if (codepoint === undefined) throw new Error(`no glyph for icon "${name}"`);
  const char = String.fromCodePoint(codepoint);
  const Icon: IconComponent = ({ size, color }) =>
    createElement(
      Text,
      {
        accessible: false,
        importantForAccessibility: "no",
        allowFontScaling: false,
        style: {
          fontFamily: ICON_FAMILY,
          fontWeight: "400",
          fontSize: size,
          lineHeight: size,
          width: size,
          height: size,
          textAlign: "center",
          includeFontPadding: false,
          color,
        },
      },
      char,
    );
  Icon.displayName = `Icon(${name})`;
  cache.set(name, Icon);
  return Icon;
}
