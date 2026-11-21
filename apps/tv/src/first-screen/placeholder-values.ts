// Named values copied from DESIGN.md §8 for the placeholder first screen; T3-06's design tokens replace this file.
// DESIGN.md gives px on the 1920×1080 canvas; a 1080p TV is 960×540 dp, so each px value is halved to dp.
const dp = (px: number) => px / 2;

export const colors = {
  surface0: "#0b0c0e",
  surface2: "#1b1c20",
  text1: "#f2efe9",
  focus: "#fff4dc",
};

export const sizes = {
  safeX: dp(96),
  safeY: dp(54),
  space5: dp(24),
  space7: dp(48),
  posterW: dp(248),
  posterH: dp(248 * 1.5),
  radiusArt: dp(6),
  focusRingWidth: dp(3),
  focusOffset: dp(3),
};

// typeTitle is 48 / 1.15 at weight 650; the system face has no 650, so the placeholder uses 600 until T3-06 bundles
// the variable face.
export const typeTitle = {
  fontSize: dp(48),
  lineHeight: dp(48 * 1.15),
  fontWeight: "600",
} as const;
