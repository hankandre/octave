// Every design token of DESIGN.md §8 (with §4's type table and §5's depth and motion tables), in canvas px on the
// 1920×1080 canvas, ms or unitless. Plain data that imports nothing, so Node reads it without React Native.
// scripts/design-tokens.test.ts compares it with DESIGN.md in both directions. Convert px with `px()` (scale.ts).

export const colors = {
  void: "#060708",
  surface0: "#0b0c0e",
  surface1: "#131417",
  surface2: "#1b1c20",
  surface3: "#25262b",
  line: "rgb(242 239 233 / .10)",
  lineStrong: "rgb(242 239 233 / .37)",
  text1: "#f2efe9",
  text2: "#a9a59d",
  text3: "#8a867f",
  onLight: "#0b0c0e",
  focus: "#fff4dc",
  focusEdge: "rgb(0 0 0 / .6)",
  danger: "#ff8a6b",
  notice: "#f0b65a",
  ok: "#8fd1a8",
  fillSecondary: "rgb(242 239 233 / .12)",
  fillIcon: "rgb(242 239 233 / .10)",
  track: "rgb(255 255 255 / .22)",
  trackBuffered: "rgb(255 255 255 / .40)",
  veil: "rgb(0 0 0 / .6)",
} as const;

export const artDefaults = {
  artAccent: "#e8c48a",
  artGlow: "rgb(232 196 138 / .22)",
  artShade: "#141210",
} as const;

export type TypeToken = { size: number; lineHeight: number; weight: number; tracking?: number; face: "ui" | "mono" };

/** `lineHeight` is a ratio of `size`, `tracking` is in em. */
export const type = {
  typeHero: { size: 72, lineHeight: 1.02, weight: 700, tracking: -0.02, face: "ui" },
  typeCode: { size: 72, lineHeight: 1.02, weight: 700, face: "mono" },
  typeTitle: { size: 48, lineHeight: 1.15, weight: 650, face: "ui" },
  typeDialogTitle: { size: 36, lineHeight: 1.15, weight: 650, face: "ui" },
  typeHeading: { size: 33, lineHeight: 1.25, weight: 600, face: "ui" },
  typeBodyLg: { size: 31.5, lineHeight: 1.55, weight: 400, face: "ui" },
  typeBody: { size: 28, lineHeight: 1.5, weight: 400, face: "ui" },
  typeLabel: { size: 24, lineHeight: 1.3, weight: 600, face: "ui" },
  typeMeta: { size: 24, lineHeight: 1.35, weight: 500, face: "ui" },
  typeMono: { size: 24, lineHeight: 1.3, weight: 500, face: "mono" },
} as const satisfies Record<string, TypeToken>;

/** A count of characters, not a size: never pass it to `px()`. */
export const textLayout = { measure: 62 } as const;

export const space = {
  space1: 4,
  space2: 8,
  space3: 12,
  space4: 16,
  space5: 24,
  space6: 32,
  space7: 48,
  space8: 64,
  space9: 96,
  safeX: 96,
  safeY: 54,
} as const;

export const sizes = {
  railCollapsedW: 96,
  railOpenW: 400,
  posterW: 248,
  thumbW: 416,
  rowGap: 48,
  controlH: 72,
  iconButton: 64,
  hitMin: 64,
  switchW: 64,
  switchH: 36,
  searchFieldH: 96,
  textFieldH: 72,
  personDisc: 200,
  playerSheetW: 640,
  playerPlayDisc: 84,
  playerStatusDisc: 64,
  upNextW: 560,
  scrubTrackH: 4,
  scrubTrackHActive: 8,
  scrubThumb: 16,
  scrubGap: 2,
  scrubPreviewW: 384,
  scrimPlayerTopH: 360,
  scrimPlayerBottomH: 440,
  posterRequestMaxW: 400,
  dialogMaxW: 840,
  toastMaxW: 840,
  emptyIcon: 72,
  switchThumb: 28,
  fieldBorderWidth: 2,
  markDisc: 24,
  cardProgressH: 4,
  qrSize: 480,
} as const;

export const radii = {
  radiusXs: 4,
  radiusArt: 6,
  radiusControl: 10,
  radiusSheet: 16,
  radiusPill: 999,
} as const;

export type Shadow = { offsetX: number; offsetY: number; blur: number; spread: number; color: "black"; alpha: number };
export type Scrim = {
  direction: "horizontal" | "vertical";
  color: "black" | "surface0";
  stops: readonly { at: number; alpha: number }[];
  height?: "scrimPlayerTopH" | "scrimPlayerBottomH";
};

/** A scrim's `at` is the fraction of its length from its solid edge; the screen that draws it picks the edge. */
export const depth = {
  shadowLift: { offsetX: 0, offsetY: 14, blur: 32, spread: -10, color: "black", alpha: 0.65 },
  shadowSheet: { offsetX: 0, offsetY: 28, blur: 72, spread: -16, color: "black", alpha: 0.75 },
  scrimHero: {
    direction: "horizontal",
    color: "surface0",
    stops: [
      { at: 0, alpha: 0.94 },
      { at: 0.38, alpha: 0.72 },
      { at: 0.72, alpha: 0 },
    ],
  },
  scrimFloor: {
    direction: "vertical",
    color: "surface0",
    stops: [
      { at: 0, alpha: 1 },
      { at: 0.4, alpha: 0 },
    ],
  },
  scrimPlayerTop: {
    direction: "vertical",
    color: "black",
    stops: [
      { at: 0, alpha: 0.85 },
      { at: 0.55, alpha: 0.85 },
      { at: 1, alpha: 0 },
    ],
    height: "scrimPlayerTopH",
  },
  scrimPlayerBottom: {
    direction: "vertical",
    color: "black",
    stops: [
      { at: 0, alpha: 0.85 },
      { at: 0.55, alpha: 0.85 },
      { at: 1, alpha: 0 },
    ],
    height: "scrimPlayerBottomH",
  },
} as const satisfies Record<string, Shadow | Scrim>;

/** A backdrop's art opacity under the scrims: Home's (DESIGN.md §7.2: 35%) and the loading player's (§7.14: 40%). */
export const backdropArt = { opacity: 0.35, playerOpacity: 0.4 } as const;

/** Durations are ms; `easeOut` and `easeInOut` are the four numbers of a cubic bezier. */
export const motion = {
  durInstant: 80,
  durQuick: 160,
  durBase: 240,
  durSlow: 480,
  easeOut: [0.16, 1, 0.3, 1],
  easeInOut: [0.65, 0, 0.35, 1],
  lift: 1.08,
  chromeIdleMs: 3000,
  savedMs: 2000,
  dwellMs: 300,
  bufferingDelayMs: 500,
  skeletonDelayMs: 150,
  toastMs: 5000,
  pressScale: 0.98,
} as const;

export const focus = {
  focusRingWidth: 3,
  focusEdgeWidth: 1,
  focusOffset: 3,
} as const;

/** DESIGN.md §8's Reduced motion row. `lift: null` means no lift. */
export const reducedMotion = {
  durQuick: 0,
  durBase: 0,
  durSlow: 120,
  lift: null,
} as const;

/** The registered family names. DESIGN.md names the faces in prose, so the parity test skips this group. */
export const faces = {
  ui: "AtkinsonHyperlegibleNext",
  mono: "AtkinsonHyperlegibleMono",
} as const;

/** The black of the shadow tokens at a given alpha, as a colour string React Native parses. */
export const blackAt = (alpha: number): string => `rgb(0 0 0 / ${alpha})`;

/** A `#rrggbb` token at a given alpha, as a colour string React Native parses (a scrim stop is a token colour at an alpha). */
export const colourAt = (hex: string, alpha: number): string => {
  const [red, green, blue] = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  return `rgb(${red} ${green} ${blue} / ${alpha})`;
};

/** The design canvas in px (DESIGN.md §6): a full-screen layer, such as the ambient backdrop, asks its art for this size. */
export const canvas = { width: 1920, height: 1080 } as const;
