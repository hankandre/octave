// T3-09 item 3: the rail's entries are Search, Home, one per library in the server's order, Settings and the account, and
// nothing reorders them.
import { describe, expect, it } from "@jest/globals";
import { railEntries } from "./rail-entries";
import { fixtureAccount, libraryA, libraryB, libraryC } from "./test-support/shell-fixtures";

const keys = (entries: { key: string }[]): string[] => entries.map((entry) => entry.key);

describe("T3-09 item 3: railEntries", () => {
  it("T3-09 item 3: three libraries in the order C, A, B give search, home, library:C, library:A, library:B, settings, account", () => {
    expect(keys(railEntries([libraryC, libraryA, libraryB], fixtureAccount))).toEqual(["search", "home", "library:C", "library:A", "library:B", "settings", "account"]);
  });

  it("T3-09 item 3: no libraries gives search, home, settings, account", () => {
    expect(keys(railEntries([], fixtureAccount))).toEqual(["search", "home", "settings", "account"]);
  });

  it("T3-09 item 3: two calls with equal input give deeply equal output, and the input order is kept, not sorted", () => {
    const first = railEntries([libraryC, libraryA, libraryB], fixtureAccount);
    const second = railEntries([libraryC, libraryA, libraryB], { ...fixtureAccount });
    expect(second).toEqual(first);
    expect(keys(railEntries([libraryB, libraryC, libraryA], undefined))).toEqual(["search", "home", "library:B", "library:C", "library:A", "settings", "account"]);
  });

  it("T3-09 item 3: each entry opens its own route and shows its own label", () => {
    const entries = railEntries([libraryA, libraryB], fixtureAccount);
    const byKey = Object.fromEntries(entries.map((entry) => [entry.key, entry]));
    expect(byKey.search?.route).toEqual({ kind: "search" });
    expect(byKey.search?.label).toBe("Search");
    expect(byKey.home?.route).toEqual({ kind: "home" });
    expect(byKey.home?.label).toBe("Home");
    expect(byKey["library:A"]?.route).toEqual({ kind: "library", id: "A" });
    expect(byKey["library:A"]?.label).toBe("Films");
    expect(byKey["library:B"]?.label).toBe("Shows");
    expect(byKey.settings?.route).toEqual({ kind: "settings" });
    expect(byKey.settings?.label).toBe("Settings");
    expect(byKey.account?.route).toEqual({ kind: "accounts" });
  });

  it("T3-09 item 3: the account entry shows the account name's first letter, upper-cased, and the name as its label", () => {
    const account = railEntries([], { name: "jo" }).find((entry) => entry.key === "account");
    expect(account?.initial).toBe("J");
    expect(account?.label).toBe("jo");
  });

  it("T3-09 item 3: with no account the account entry has no initial and the label Who's watching?", () => {
    const account = railEntries([libraryA]).find((entry) => entry.key === "account");
    expect(account?.initial).toBeUndefined();
    expect(account?.label).toBe("Who's watching?");
  });

  it("T3-09 item 3: a library's icon follows its collection type", () => {
    const entries = railEntries([libraryA, libraryB, libraryC], fixtureAccount);
    const icon = (key: string) => entries.find((entry) => entry.key === key)?.icon;
    expect(icon("library:A")).toBe("movies");
    expect(icon("library:B")).toBe("tvshows");
    expect(icon("library:C")).toBe("boxsets");
    expect(icon("search")).toBe("search");
    expect(icon("home")).toBe("home");
    expect(icon("settings")).toBe("settings");
    expect(icon("account")).toBe("account");
  });
});
