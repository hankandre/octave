// T3-09 items 6 and 7: the routes module is the one place a route is built or parsed, chrome says which routes have the
// rail, and an unknown path is `notFound`. The source scan keeps every other file from building a route or calling a
// navigation API.
import { describe, expect, it } from "@jest/globals";
import { buildPath, chromeOf, fromScreen, isRoot, parsePath, railKeyOf, toScreen } from "./routes";
import type { Route } from "./routes";

const EVERY_KIND: { route: Route; path: string }[] = [
  { route: { kind: "home" }, path: "/" },
  { route: { kind: "search" }, path: "/search" },
  { route: { kind: "library", id: "A" }, path: "/library/A" },
  { route: { kind: "settings" }, path: "/settings" },
  { route: { kind: "accounts" }, path: "/accounts" },
  { route: { kind: "item", id: "item-1" }, path: "/item/item-1" },
  { route: { kind: "play", id: "item_2" }, path: "/play/item_2" },
  { route: { kind: "signIn" }, path: "/sign-in" },
  { route: { kind: "notFound" }, path: "/not-found" },
];

describe("T3-09 item 6: chrome", () => {
  it("T3-09 item 6: chromeOf is none for play and signIn and rail for every other kind", () => {
    for (const { route } of EVERY_KIND) {
      const expected = route.kind === "play" || route.kind === "signIn" ? "none" : "rail";
      expect(chromeOf(route)).toBe(expected);
    }
  });

  it("T3-09 item 6: isRoot is true for home, search, library, settings and accounts only", () => {
    for (const { route } of EVERY_KIND) {
      const expected = ["home", "search", "library", "settings", "accounts"].includes(route.kind);
      expect(isRoot(route)).toBe(expected);
    }
  });

  it("T3-09 item 6: railKeyOf gives the entry a root opens", () => {
    expect(railKeyOf({ kind: "home" })).toBe("home");
    expect(railKeyOf({ kind: "search" })).toBe("search");
    expect(railKeyOf({ kind: "library", id: "A" })).toBe("library:A");
    expect(railKeyOf({ kind: "settings" })).toBe("settings");
    expect(railKeyOf({ kind: "accounts" })).toBe("account");
  });
});

describe("T3-09 item 7: building and parsing", () => {
  it("T3-09 item 7: buildPath gives the nine paths", () => {
    for (const { route, path } of EVERY_KIND) expect(buildPath(route)).toBe(path);
  });

  it("T3-09 item 7: parsePath(buildPath(r)) deep-equals r for one route of every kind", () => {
    for (const { route } of EVERY_KIND) expect(parsePath(buildPath(route))).toEqual(route);
  });

  it("T3-09 item 7: parsePath reads each of the nine paths", () => {
    for (const { route, path } of EVERY_KIND) expect(parsePath(path)).toEqual(route);
  });

  it("T3-09 item 7: fromScreen(...toScreen(r)) deep-equals r for one route of every kind", () => {
    for (const { route } of EVERY_KIND) {
      const screen = toScreen(route);
      expect(fromScreen(screen.name, screen.params)).toEqual(route);
    }
  });

  it("T3-09 item 7: toScreen names the stack screen after the route kind and carries the id only for the routes that have one", () => {
    expect(toScreen({ kind: "home" }).name).toBe("home");
    expect(toScreen({ kind: "home" }).params).toBeUndefined();
    expect(toScreen({ kind: "signIn" })).toEqual({ name: "signIn" });
    expect(toScreen({ kind: "library", id: "A" })).toEqual({ name: "library", params: { id: "A" } });
    expect(toScreen({ kind: "item", id: "x" })).toEqual({ name: "item", params: { id: "x" } });
    expect(toScreen({ kind: "play", id: "x" })).toEqual({ name: "play", params: { id: "x" } });
  });

  it("T3-09 item 7: fromScreen gives notFound for an unknown name and for a missing or empty id", () => {
    expect(fromScreen("nope")).toEqual({ kind: "notFound" });
    expect(fromScreen("library")).toEqual({ kind: "notFound" });
    expect(fromScreen("library", {})).toEqual({ kind: "notFound" });
    expect(fromScreen("item", { id: "" })).toEqual({ kind: "notFound" });
    expect(fromScreen("play", undefined)).toEqual({ kind: "notFound" });
  });

  it("T3-09 item 7: parsePath gives notFound for every path it does not know", () => {
    const refused = ["/nope", "", "/library/", "/library/a/b", "/library/a b", "/item/../x", "/library/A?x=1", "/#x", "//library/A", `/library/${"a".repeat(129)}`];
    for (const path of refused) expect(parsePath(path)).toEqual({ kind: "notFound" });
  });

  it("T3-09 item 7: parsePath refuses a query or fragment on every kind, a percent sign and a trailing slash", () => {
    for (const path of ["/?x=1", "/search#a", "/settings?x", "/library/A%20B", "/item/%2e%2e", "/search/", "/accounts/x", "/sign-in/x"]) {
      expect(parsePath(path)).toEqual({ kind: "notFound" });
    }
  });

  it("T3-09 item 7: parsePath takes an id of 128 characters from letters, digits, underscore and hyphen, and no longer one", () => {
    const longest = `${"a".repeat(64)}${"B".repeat(32)}${"0".repeat(16)}${"_".repeat(8)}${"-".repeat(8)}`;
    expect(longest).toHaveLength(128);
    expect(parsePath(`/item/${longest}`)).toEqual({ kind: "item", id: longest });
    expect(parsePath(`/item/${longest}a`)).toEqual({ kind: "notFound" });
  });

  it("T3-09 item 7: buildPath throws on an id that parsePath would refuse", () => {
    expect(() => buildPath({ kind: "library", id: "a b" })).toThrow();
    expect(() => buildPath({ kind: "item", id: "" })).toThrow();
    expect(() => buildPath({ kind: "play", id: "a".repeat(129) })).toThrow();
    expect(() => buildPath({ kind: "library", id: "../x" })).toThrow();
  });
});

// apps/tv has no Node type definitions, so the two Node modules the scan reads files with are typed here, by what it calls.
declare const __dirname: string;
const { readdirSync, readFileSync, statSync } = require("fs") as {
  readdirSync(dir: string): string[];
  readFileSync(path: string, encoding: "utf8"): string;
  statSync(path: string): { isDirectory(): boolean };
};
const { join, relative, sep } = require("path") as {
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
  sep: string;
};

const SRC = join(__dirname, "..");

/** Every .ts and .tsx file under `apps/tv/src` that is not a test and not under a `test-support/` directory. */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "test-support" || name === "node_modules") continue;
      found.push(...sourceFiles(path));
      continue;
    }
    if (!/\.tsx?$/.test(name)) continue;
    if (/\.test\.tsx?$/.test(name)) continue;
    found.push(path);
  }
  return found;
}

const ROUTE_PREFIX = /["'`]\/(?:search|library\/|settings|accounts|item\/|play\/|sign-in|not-found)/;
const NAVIGATION_ONLY: RegExp[] = [
  /\bStackActions\b/,
  /\bCommonActions\b/,
  /\bcreateNavigationContainerRef\b/,
  /\buseNavigation\b/,
  /\bNavigationContainer\b/,
  /\bcreateNativeStackNavigator\b/,
  /\.navigate\(/,
  /\bnavigation(Ref)?(\.current)?\??\.(push|reset|replace|pop|goBack|dispatch)\(/,
];

describe("T3-09 item 7: one module owns the routes", () => {
  const files = sourceFiles(SRC).map((path) => ({ path, rel: relative(SRC, path).split(sep).join("/") }));

  it("T3-09 item 7: the scan reads App.tsx and files under e2e/, so an empty glob fails", () => {
    expect(files.some((file) => file.rel === "App.tsx")).toBe(true);
    expect(files.some((file) => file.rel.startsWith("e2e/"))).toBe(true);
  });

  it("T3-09 item 7: no string literal outside shell/routes.ts starts with a route prefix", () => {
    const offenders = files
      .filter((file) => file.rel !== "shell/routes.ts")
      .filter((file) => ROUTE_PREFIX.test(readFileSync(file.path, "utf8")))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it("T3-09 item 7: no navigation API is used outside apps/tv/src/shell/", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file.rel.startsWith("shell/")) continue;
      const text = readFileSync(file.path, "utf8");
      for (const pattern of NAVIGATION_ONLY) {
        if (pattern.test(text)) offenders.push(`${file.rel}: ${pattern.source}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
