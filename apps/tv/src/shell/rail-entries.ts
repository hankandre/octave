// The rail's entries (T3-09 item 3): Search, Home, one per library in the server's order, Settings and the account. The order
// is a function of the input alone: nothing reorders by use, focus or selection.
import type { LibraryView } from "@octave/core/src/domain/catalog";
import type { Route } from "./routes";

export type RailKey = "search" | "home" | `library:${string}` | "settings" | "account";
export type RailIconName = "search" | "home" | "movies" | "tvshows" | "boxsets" | "settings" | "account";

export type RailEntry = {
  key: RailKey;
  label: string;
  route: Route;
  icon: RailIconName;
  /** The account's first letter, upper-cased, shown instead of an icon. */
  initial?: string;
};

const NO_ACCOUNT_LABEL = "Who's watching?";

function libraryIcon(collectionType: string): RailIconName {
  switch (collectionType) {
    case "tvshows":
      return "tvshows";
    case "boxsets":
      return "boxsets";
    default:
      return "movies";
  }
}

export function railEntries(libraries: readonly LibraryView[], account?: { name: string }): RailEntry[] {
  const initial = account === undefined ? undefined : Array.from(account.name)[0]?.toUpperCase();
  const accountEntry: RailEntry = {
    key: "account",
    label: account === undefined ? NO_ACCOUNT_LABEL : account.name,
    route: { kind: "accounts" },
    icon: "account",
    ...(initial === undefined ? {} : { initial }),
  };
  return [
    { key: "search", label: "Search", route: { kind: "search" }, icon: "search" },
    { key: "home", label: "Home", route: { kind: "home" }, icon: "home" },
    ...libraries.map(
      (library): RailEntry => ({ key: `library:${library.id}`, label: library.name, route: { kind: "library", id: library.id }, icon: libraryIcon(library.collectionType) }),
    ),
    { key: "settings", label: "Settings", route: { kind: "settings" }, icon: "settings" },
    accountEntry,
  ];
}
