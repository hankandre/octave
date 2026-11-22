// @vitest-environment node
// T3-06 items 1 and 5: the design tokens in apps/tv/src/design/tokens.ts match DESIGN.md §8 (with §4's type table and
// §5's depth and motion tables that §8 defers to) in both directions, and no type token is under 24 canvas px.
// The reading rules are the spec's ("How the parity test reads DESIGN.md"): backticked name then value, units and
// parenthesised notes dropped, U+2212 read as a minus, colours compared after trim, lower-case and whitespace collapse.
// `tokens.ts` imports nothing, so Node reads it directly.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const markdown = readFileSync(join(repo, "DESIGN.md"), "utf8").replace(/−/g, "-");

// ---------- reading DESIGN.md ----------

function section(start: RegExp, end: RegExp): string {
  const from = markdown.search(start);
  expect(from, `DESIGN.md has a section matching ${start}`).toBeGreaterThanOrEqual(0);
  const rest = markdown.slice(from + 1);
  const to = rest.search(end);
  return to < 0 ? rest : rest.slice(0, to);
}

function tableRows(text: string): string[][] {
  return text
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .map((line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()))
    .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)));
}

const section8 = () => section(/^## 8\. Tokens/m, /^## 9\./m);
const section4 = () => section(/^## 4\. Typography/m, /^## 5\./m);
const section5 = () => section(/^## 5\. Space, shape, depth, motion/m, /^## 6\./m);

type Entry = { name: string; value: string | null };

/** Entries of a §8 cell: `name` then an optional value. Colour cells have backticked values. */
function entries(cell: string, backtickedValues: boolean): Entry[] {
  if (backtickedValues) {
    return [...cell.matchAll(/`(\w+)`\s+`([^`]+)`/g)].map((m) => ({ name: m[1], value: m[2] }));
  }
  const cleaned = cell.replace(/\([^)]*\)/g, "").replace(/§\d+:/g, "");
  return cleaned
    .split(/[,;]/)
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((piece) => {
      const m = piece.match(/^`(\w+)`(?:\s+(.*))?$/);
      expect(m, `§8 entry "${piece}" is a backticked name then a value`).not.toBeNull();
      return { name: m![1], value: m![2]?.trim() || null };
    });
}

function groupCell(group: string): string {
  const row = tableRows(section8()).find((cells) => cells[0] === group);
  expect(row, `§8 has a "${group}" row`).toBeDefined();
  return row![1];
}

const numberOf = (value: string | null, what: string): number => {
  const n = Number((value ?? "").replace(/\s*(ms|characters|Mono)\s*$/, ""));
  expect(Number.isFinite(n), `${what} is a number (read "${value}")`).toBe(true);
  return n;
};

function numberGroup(group: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { name, value } of entries(groupCell(group), false)) out[name] = numberOf(value, `${group} ${name}`);
  return out;
}

type TypeToken = { size: number; lineHeight: number; weight: number; tracking?: number; face: "ui" | "mono" };

/** §4's "Scale" table: token, `size / line height` with optional tracking and Mono, weight. */
function scaleTable(): Record<string, TypeToken> {
  const out: Record<string, TypeToken> = {};
  const text = section4();
  const from = text.indexOf("**Scale**");
  expect(from, "§4 has the Scale table").toBeGreaterThanOrEqual(0);
  for (const cells of tableRows(text.slice(from))) {
    const name = cells[0].match(/^`(\w+)`$/)?.[1];
    if (!name) continue;
    const m = cells[1].match(/^(\d*\.?\d+)\s*\/\s*(\d*\.?\d+)/);
    expect(m, `§4 ${name} has size / line height`).not.toBeNull();
    const tracking = cells[1].match(/tracking\s*(-?\d*\.?\d+)\s*em/);
    out[name] = {
      size: Number(m![1]),
      lineHeight: Number(m![2]),
      weight: Number(cells[2]),
      ...(tracking ? { tracking: Number(tracking[1]) } : {}),
      face: /\bMono\b/.test(cells[1]) ? "mono" : "ui",
    };
  }
  return out;
}

type Shadow = { offsetX: number; offsetY: number; blur: number; spread: number; color: string; alpha: number };
type Scrim = { direction: string; color: string; stops: { at: number; alpha: number }[]; height?: string };

function elevationRows(): Record<string, string> {
  const out: Record<string, string> = {};
  const text = section5();
  const from = text.indexOf("**Elevation**");
  for (const cells of tableRows(text.slice(from))) {
    const name = cells[0].match(/^`(\w+)`$/)?.[1];
    if (name) out[name] = cells[1];
  }
  return out;
}

function readShadow(name: string, cell: string): Shadow {
  const m = cell.match(/offset\s+(-?\d+)\s+(-?\d+),\s*blur\s+(\d+),\s*spread\s+(-?\d+),\s*black at\s+(\d*\.?\d+)/);
  expect(m, `§5 ${name} is "offset X Y, blur B, spread S, black at A"`).not.toBeNull();
  return { offsetX: Number(m![1]), offsetY: Number(m![2]), blur: Number(m![3]), spread: Number(m![4]), color: "black", alpha: Number(m![5]) };
}

function readScrim(name: string, cell: string, sizes: Record<string, number>): Scrim {
  const gradient = cell.match(/^(horizontal|vertical) gradient,\s*`(\w+)`(.*)$/);
  if (gradient) {
    const direction = gradient[1];
    const color = gradient[2];
    const rest = gradient[3];
    const floor = rest.match(/^\s*\((\d+)%\)\s*to transparent\s*\((\d+)%\)/);
    if (floor) {
      return { direction, color, stops: [{ at: Number(floor[1]) / 100, alpha: 1 }, { at: Number(floor[2]) / 100, alpha: 0 }] };
    }
    const stops = [...rest.matchAll(/(\d*\.?\d+)\s*\((\d+)%\)/g)].map((m) => ({ at: Number(m[2]) / 100, alpha: Number(m[1]) }));
    expect(stops.length, `§5 ${name} lists its stops`).toBeGreaterThan(0);
    return { direction, color, stops };
  }
  const player = cell.match(/^black at\s+(\d*\.?\d+)\s+to\s+(\d+)%,\s*then to 0;\s*(\d+)\s*px tall/);
  expect(player, `§5 ${name} is "black at A to P%, then to 0; H px tall" or a gradient`).not.toBeNull();
  const height = Object.keys(sizes).find((key) => /^scrimPlayer(Top|Bottom)H$/.test(key) && sizes[key] === Number(player![3]) && name.endsWith(key.slice("scrimPlayer".length, -1)));
  return {
    direction: "vertical",
    color: "black",
    stops: [{ at: 0, alpha: Number(player![1]) }, { at: Number(player![2]) / 100, alpha: Number(player![1]) }, { at: 1, alpha: 0 }],
    height: height ?? `(no sizes token is ${player![3]} px)`,
  };
}

function motionTable(): Record<string, string> {
  const out: Record<string, string> = {};
  const text = section5();
  const from = text.indexOf("**Motion.**");
  for (const cells of tableRows(text.slice(from))) {
    const name = cells[0].match(/^`(\w+)`$/)?.[1];
    if (name) out[name] = cells[1];
  }
  return out;
}

type Design = {
  colors: Record<string, string>;
  artDefaults: Record<string, string>;
  type: Record<string, TypeToken>;
  textLayout: { measure: number };
  space: Record<string, number>;
  sizes: Record<string, number>;
  radii: Record<string, number>;
  depth: Record<string, Shadow | Scrim>;
  motion: Record<string, number | number[]>;
  focus: Record<string, number>;
  reducedMotion: Record<string, number | null>;
};

function readDesign(): Design {
  const colorGroup = (group: string) => Object.fromEntries(entries(groupCell(group), true).map(({ name, value }) => [name, value as string]));

  // Type: names from §8, values from §4's Scale table. `measure` is a count of characters, not a type token.
  const typeCell = entries(groupCell("Type"), false);
  const scale = scaleTable();
  const typeTokens: Record<string, TypeToken> = {};
  let measure = Number.NaN;
  for (const { name, value } of typeCell) {
    if (name === "measure") {
      measure = numberOf(value, "measure");
      continue;
    }
    expect(scale[name], `§4's Scale table has ${name}, which §8's Type row names`).toBeDefined();
    expect(numberOf(value, `§8 ${name}`), `§8 and §4 give ${name} the same size`).toBe(scale[name].size);
    typeTokens[name] = scale[name];
  }

  const space = numberGroup("Space");
  const sizes = numberGroup("Sizes");
  const radii = numberGroup("Shape");

  const elevation = elevationRows();
  const depth: Record<string, Shadow | Scrim> = {};
  for (const { name } of entries(groupCell("Depth"), false)) {
    expect(elevation[name], `§5's Elevation table has ${name}`).toBeDefined();
    depth[name] = name.startsWith("shadow") ? readShadow(name, elevation[name]) : readScrim(name, elevation[name], sizes);
  }

  const motionTokens: Record<string, number | number[]> = {};
  const motionRows = motionTable();
  for (const { name, value } of entries(groupCell("Motion"), false)) {
    if (name === "easeOut" || name === "easeInOut") {
      const bezier = motionRows[name]?.match(/cubic-bezier\(\s*([^)]*)\)/);
      expect(bezier, `§5 gives ${name} as cubic-bezier(...)`).not.toBeNull();
      motionTokens[name] = bezier![1].split(",").map((part) => Number(part.trim()));
      continue;
    }
    motionTokens[name] = numberOf(value, `§8 ${name}`);
    if (name === "lift") {
      const five = motionRows.lift?.match(/scale\s+(\d*\.?\d+)/);
      expect(five, "§5 gives lift as scale N").not.toBeNull();
      expect(Number(five![1]), "§5 and §8 agree on lift").toBe(motionTokens.lift);
    }
  }

  const reduced: Record<string, number | null> = {};
  for (const { name, value } of entries(groupCell("Reduced motion"), false)) reduced[name] = value === "none" ? null : numberOf(value, `reduced ${name}`);

  return {
    colors: colorGroup("Colour"),
    artDefaults: colorGroup("Artwork defaults"),
    type: typeTokens,
    textLayout: { measure },
    space,
    sizes,
    radii,
    depth,
    motion: motionTokens,
    focus: numberGroup("Focus"),
    reducedMotion: reduced,
  };
}

// ---------- comparing the two, in both directions ----------

const normaliseColour = (value: unknown) => String(value).trim().toLowerCase().replace(/\s+/g, " ");

function normalType(token: Record<string, unknown>) {
  return { size: token.size, lineHeight: token.lineHeight, weight: token.weight, tracking: token.tracking ?? 0, face: token.face };
}

/** JSON with object keys sorted, so two objects with the same fields in another order compare equal. */
function canon(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
}

/** Every difference between DESIGN.md and a token object, as readable lines. Empty when they match. */
function diffTokens(design: Design, actual: Record<string, any>): string[] {
  const out: string[] = [];
  const compareGroup = (group: string, want: Record<string, unknown>, normal: (v: any) => unknown = (v) => v) => {
    const have = (actual[group] ?? {}) as Record<string, unknown>;
    for (const name of Object.keys(want)) {
      if (!(name in have)) out.push(`${group}.${name} is in DESIGN.md but not in tokens.ts`);
      else if (canon(normal(have[name])) !== canon(normal(want[name]))) out.push(`${group}.${name} is ${JSON.stringify(have[name])} in tokens.ts and ${JSON.stringify(want[name])} in DESIGN.md`);
    }
    for (const name of Object.keys(have)) if (!(name in want)) out.push(`${group}.${name} is in tokens.ts but not in DESIGN.md`);
  };
  compareGroup("colors", design.colors, normaliseColour);
  compareGroup("artDefaults", design.artDefaults, normaliseColour);
  compareGroup("type", design.type, normalType);
  compareGroup("textLayout", design.textLayout);
  compareGroup("space", design.space);
  compareGroup("sizes", design.sizes);
  compareGroup("radii", design.radii);
  compareGroup("depth", design.depth);
  compareGroup("motion", design.motion);
  compareGroup("focus", design.focus);
  compareGroup("reducedMotion", design.reducedMotion);
  return out;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
// Loaded lazily, so a missing tokens.ts fails each test that needs it and not the whole file.
let loaded: Record<string, any> | undefined;
async function loadTokens(): Promise<Record<string, any>> {
  loaded ??= (await import("../apps/tv/src/design/tokens")) as Record<string, any>;
  return loaded;
}

describe("T3-06 item 1: tokens.ts matches DESIGN.md", () => {
  it("reads §8, §4 and §5 as the spec's rules say", () => {
    const design = readDesign();
    expect(design.colors.void).toBe("#060708");
    expect(normaliseColour(design.colors.line)).toBe("rgb(242 239 233 / .10)");
    expect(design.type.typeHero).toEqual({ size: 72, lineHeight: 1.02, weight: 700, tracking: -0.02, face: "ui" });
    expect(design.type.typeCode.face).toBe("mono");
    expect(design.textLayout.measure).toBe(62);
    expect(design.depth.shadowLift).toEqual({ offsetX: 0, offsetY: 14, blur: 32, spread: -10, color: "black", alpha: 0.65 });
    expect(design.depth.scrimHero).toEqual({ direction: "horizontal", color: "surface0", stops: [{ at: 0, alpha: 0.94 }, { at: 0.38, alpha: 0.72 }, { at: 0.72, alpha: 0 }] });
    expect(design.depth.scrimFloor).toEqual({ direction: "vertical", color: "surface0", stops: [{ at: 0, alpha: 1 }, { at: 0.4, alpha: 0 }] });
    expect(design.depth.scrimPlayerTop).toMatchObject({ height: "scrimPlayerTopH" });
    expect(design.depth.scrimPlayerBottom).toMatchObject({ height: "scrimPlayerBottomH" });
    expect(design.motion.easeOut).toEqual([0.16, 1, 0.3, 1]);
    expect(design.reducedMotion.lift).toBeNull();
  });

  it("has every DESIGN.md token in tokens.ts with an equal value, and no token DESIGN.md lacks", async () => {
    expect(diffTokens(readDesign(), await loadTokens())).toEqual([]);
  });

  it("groups the tokens as the spec names them, and `faces` maps ui and mono to family names", async () => {
    const t = await loadTokens();
    for (const group of ["colors", "artDefaults", "type", "textLayout", "space", "sizes", "radii", "depth", "motion", "focus", "reducedMotion", "faces"]) {
      expect(t[group], `tokens.ts exports ${group}`).toBeTypeOf("object");
    }
    expect(Object.keys(t.faces).sort()).toEqual(["mono", "ui"]);
    expect(t.motion.lift).toBe(1.08);
    expect(t.reducedMotion).toMatchObject({ durQuick: 0, durBase: 0, durSlow: 120, lift: null });
  });

  it("fails when any single value differs", async () => {
    const design = readDesign();
    const real = clone(await loadTokens());
    const plants: [string, (t: Record<string, any>) => void][] = [
      ["a colour", (t) => (t.colors.surface1 = "#131418")],
      ["a space", (t) => (t.space.space5 += 4)],
      ["a size", (t) => (t.sizes.posterW += 1)],
      ["a radius", (t) => (t.radii.radiusControl += 1)],
      ["a type size", (t) => (t.type.typeBody.size += 1)],
      ["a type weight", (t) => (t.type.typeLabel.weight += 100)],
      ["a type face", (t) => (t.type.typeMono.face = "ui")],
      ["a duration", (t) => (t.motion.durQuick += 10)],
      ["an easing", (t) => (t.motion.easeOut[1] = 0.9)],
      ["the lift", (t) => (t.motion.lift = 1.1)],
      ["a shadow field", (t) => (t.depth.shadowSheet.blur += 1)],
      ["a scrim stop", (t) => (t.depth.scrimHero.stops[1].alpha = 0.7)],
      ["a scrim height", (t) => (t.depth.scrimPlayerBottom.height = "scrimPlayerTopH")],
      ["a focus value", (t) => (t.focus.focusRingWidth += 1)],
      ["a reduced-motion value", (t) => (t.reducedMotion.durSlow = 0)],
      ["the measure", (t) => (t.textLayout.measure = 60)],
      ["an extra token", (t) => (t.sizes.extraSize = 1)],
      ["a missing token", (t) => delete t.colors.focus],
    ];
    for (const [what, plant] of plants) {
      const copy = clone(real);
      plant(copy);
      expect(diffTokens(design, copy), `changing ${what} is reported`).not.toEqual([]);
    }
  });

  it("reads tokens.ts with no import, so it loads in Node without React Native", () => {
    const source = readFileSync(join(repo, "apps/tv/src/design/tokens.ts"), "utf8");
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(/);
  });
});

// Item 5. The helper below is the one the planted copy runs through.
function typeProblems(type: Record<string, { size: number; lineHeight: number }>): string[] {
  const out: string[] = [];
  for (const [name, token] of Object.entries(type)) {
    if (!(token.size >= 24)) out.push(`${name} is ${token.size} canvas px, under 24`);
    if (!(token.lineHeight >= 1)) out.push(`${name} has line height ${token.lineHeight}, which is not a ratio of at least 1`);
  }
  return out;
}

describe("T3-06 item 5: no text renders under 24 px on the 1920 by 1080 canvas", () => {
  it("has every type token at 24 canvas px or more, with a ratio line height", async () => {
    const { type } = await loadTokens();
    expect(Object.keys(type).length).toBeGreaterThan(0);
    expect(typeProblems(type)).toEqual([]);
  });

  it("has exactly the token names of DESIGN.md §4's Scale table, and no measure among them", async () => {
    const t = await loadTokens();
    const names = Object.keys(scaleTable()).sort();
    expect(names.length).toBeGreaterThan(0);
    expect(Object.keys(t.type).sort()).toEqual(names);
    expect(t.type).not.toHaveProperty("measure");
    expect(t.textLayout).toEqual({ measure: 62 });
  });

  it("fails the same helper on a planted 23 px copy", async () => {
    const { type } = await loadTokens();
    const copy = clone(type);
    copy.typeBody.size = 23;
    expect(typeProblems(copy)).toEqual([expect.stringContaining("typeBody")]);
    const squashed = clone(type);
    squashed.typeMeta.lineHeight = 0.9;
    expect(typeProblems(squashed)).not.toEqual([]);
  });
});
