// A scrim token (tokens.ts, `depth`) drawn as a gradient from its solid edge: a stop's `at` is the fraction of the
// scrim's length from that edge. The screen that draws it picks the edge by the direction it fades toward.
import type { ViewStyle } from "react-native";
import { blackAt, colors, colourAt, depth } from "./tokens";

export type ScrimName = "scrimHero" | "scrimFloor" | "scrimPlayerTop" | "scrimPlayerBottom";

export function scrimStyle(name: ScrimName, toward: "to right" | "to top" | "to bottom"): ViewStyle {
  const { color, stops } = depth[name];
  const solid = (alpha: number): string => (color === "black" ? blackAt(alpha) : colourAt(colors[color], alpha));
  const gradient = stops.map(({ at, alpha }) => `${solid(alpha)} ${at * 100}%`).join(", ");
  return { backgroundImage: `linear-gradient(${toward}, ${gradient})` } as ViewStyle;
}
