// T5-03 item 8: Home builds no media URL and calls no player method. Home reaches the server only through the six reads of
// HomeSource and HeroSource, and hands playback only `{ itemId, start }`. The import scan reads the screen's source files.
import { describe, expect, it, jest } from "@jest/globals";
import { screen } from "@testing-library/react-native";
import { MINUTE, defaultLists, detailOf, makeRig, press, renderHome, rowCard } from "./test-support/home-doubles";

// apps/tv has no Node type definitions, so the two Node modules the scan reads files with are typed here, by what it calls.
declare const __dirname: string;
const { readdirSync, readFileSync } = require("fs") as {
  readdirSync(dir: string, options: { withFileTypes: true }): { name: string; isFile(): boolean }[];
  readFileSync(path: string, encoding: "utf8"): string;
};
const { join } = require("path") as { join(...parts: string[]): string };

jest.mock("@shopify/flash-list", () => require("../design/rows/test-support/flash-list-double"));

const ALLOWED = ["resumeItems", "nextUp", "recentlyPlayed", "latestItems", "itemDetail", "seriesNextUp"];

/** A source that records every read of a member and throws for any method outside the six. */
function proxySource() {
  const lists = defaultLists();
  const called: string[] = [];
  const outside: string[] = [];
  const answers: Record<string, (...args: unknown[]) => unknown> = {
    resumeItems: async () => lists.resume,
    nextUp: async () => lists.nextUp,
    recentlyPlayed: async () => lists.recentlyPlayed,
    latestItems: async () => lists.latest,
    itemDetail: async (id: unknown) => detailOf(String(id)),
    seriesNextUp: async () => undefined,
  };
  const source = new Proxy({}, {
    get(_target, name) {
      if (typeof name === "symbol" || name === "then" || name === "toJSON") return undefined;
      if (ALLOWED.includes(name)) {
        return (...args: unknown[]) => {
          called.push(name);
          return answers[name]!(...args);
        };
      }
      outside.push(name);
      return () => {
        throw new Error(`Home called ${name}`);
      };
    },
  });
  return { source, called, outside };
}

describe("T5-03 item 8: Home reaches only the six reads and play", () => {
  it("T5-03 item 8: a load, a hero select and a card select call only the allowed reads, and play gets only an id and a start", async () => {
    const { source, called, outside } = proxySource();
    const rig = makeRig({}, { source: source as never });
    await renderHome(rig);
    await press("home-hero-primary");
    await press(rowCard("continue-watching", 0));
    await press(rowCard("continue-watching", 2));
    await press("home-hero-more-info");
    await press(rowCard("recently-added", 0));
    expect(outside).toEqual([]);
    expect(called.length).toBeGreaterThan(0);
    expect(called.every((name) => ALLOWED.includes(name))).toBe(true);
    expect(called.filter((name) => name === "itemDetail")).toHaveLength(1);
    expect(rig.play).toHaveBeenCalledTimes(3);
    for (const [request] of rig.play.mock.calls) {
      expect(Object.keys(request).sort()).toEqual(["itemId", "start"]);
      expect(Object.keys(request.start).sort()).toEqual(["kind", "startPositionTicks"]);
      const text = JSON.stringify(request);
      expect(text).not.toContain("/Videos/");
      expect(text).not.toContain("://");
    }
    expect(rig.play.mock.calls[0]?.[0]).toEqual({ itemId: "hero-film", start: { kind: "resume", startPositionTicks: 90 * MINUTE } });
  });

  it("T5-03 item 8: without services Home draws an empty screen and requests nothing", async () => {
    const rig = makeRig();
    await renderHome(rig, { services: false });
    expect(screen.queryByTestId("home-hero-primary")).toBeNull();
    expect(screen.queryAllByTestId(/^home-rows-row-/)).toHaveLength(0);
    expect(rig.source.resumeItems).not.toHaveBeenCalled();
    expect(rig.source.latestItems).not.toHaveBeenCalled();
    expect(rig.source.itemDetail).not.toHaveBeenCalled();
  });
});

const FORBIDDEN: RegExp[] = [/host\/player-/, /^@octave\/player/, /@octave\/core\/src\/player\//, /jellyfin\/hls-url/, /jellyfin\/device-profile/, /player\/launch-request/];

type Import = { specifier: string; typeOnly: boolean };

function importsOf(source: string): Import[] {
  const found: Import[] = [];
  for (const match of source.matchAll(/(?:^|\n)\s*(import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/g)) {
    found.push({ specifier: match[4]!, typeOnly: match[2] !== undefined });
  }
  for (const match of source.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) found.push({ specifier: match[1]!, typeOnly: false });
  for (const match of source.matchAll(/(?:require|import)\(\s*["']([^"']+)["']\s*\)/g)) found.push({ specifier: match[1]!, typeOnly: false });
  return found;
}

describe("T5-03 item 8: what Home's source files import", () => {
  const dir = __dirname;
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  it("T5-03 item 8: the screen's own files exist to be scanned", () => {
    expect(files).toEqual(expect.arrayContaining(["ambient-backdrop.tsx", "home-cards.ts", "home-screen.tsx", "home-services.tsx", "hero.tsx", "index.ts", "use-dwell.ts"]));
  });

  it("T5-03 item 8: no file imports a player module, a media URL builder, a device profile or a launch request", () => {
    for (const file of files) {
      const imports = importsOf(readFileSync(join(dir, file), "utf8"));
      for (const { specifier } of imports) {
        expect(FORBIDDEN.filter((pattern) => pattern.test(specifier)).map(() => `${file}: ${specifier}`)).toEqual([]);
      }
    }
  });

  it("T5-03 item 8: no file takes a value import from the gateway", () => {
    for (const file of files) {
      const imports = importsOf(readFileSync(join(dir, file), "utf8"));
      expect(imports.filter(({ specifier, typeOnly }) => /jellyfin\/gateway/.test(specifier) && !typeOnly).map(({ specifier }) => `${file}: ${specifier}`)).toEqual([]);
    }
  });
});
