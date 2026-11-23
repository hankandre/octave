// The one place a route is built or parsed (T3-09 item 7). A route holds ids only: never a URL, a session id, a play-session
// id or a token. `parsePath` refuses everything it does not know, so an unknown path is the not-found state, never a throw.
import type { RailKey } from "./rail-entries";

export type Route =
  | { kind: "home" }
  | { kind: "search" }
  | { kind: "library"; id: string }
  | { kind: "settings" }
  | { kind: "accounts" }
  | { kind: "item"; id: string }
  | { kind: "play"; id: string }
  | { kind: "signIn" }
  | { kind: "notFound" };

export type RouteKind = Route["kind"];

const ID = /^[A-Za-z0-9_-]{1,128}$/;

const isId = (value: unknown): value is string => typeof value === "string" && ID.test(value);

export function buildPath(route: Route): string {
  switch (route.kind) {
    case "home":
      return "/";
    case "search":
      return "/search";
    case "settings":
      return "/settings";
    case "accounts":
      return "/accounts";
    case "signIn":
      return "/sign-in";
    case "notFound":
      return "/not-found";
    case "library":
    case "item":
    case "play": {
      if (!isId(route.id)) throw new Error(`Route ${route.kind} has an id that cannot be built into a path`);
      const prefix = route.kind === "library" ? "/library/" : route.kind === "item" ? "/item/" : "/play/";
      return `${prefix}${route.id}`;
    }
  }
}

export function parsePath(path: string): Route {
  if (!path.startsWith("/") || /[?#%]/.test(path)) return { kind: "notFound" };
  if (path === "/") return { kind: "home" };
  const parts = path.slice(1).split("/");
  const [head, id] = parts;
  if (parts.length === 1) {
    switch (head) {
      case "search":
        return { kind: "search" };
      case "settings":
        return { kind: "settings" };
      case "accounts":
        return { kind: "accounts" };
      case "sign-in":
        return { kind: "signIn" };
      case "not-found":
        return { kind: "notFound" };
      default:
        return { kind: "notFound" };
    }
  }
  if (parts.length === 2 && isId(id)) {
    switch (head) {
      case "library":
        return { kind: "library", id };
      case "item":
        return { kind: "item", id };
      case "play":
        return { kind: "play", id };
      default:
        return { kind: "notFound" };
    }
  }
  return { kind: "notFound" };
}

export function toScreen(route: Route): { name: RouteKind; params?: { id: string } } {
  switch (route.kind) {
    case "library":
    case "item":
    case "play":
      return { name: route.kind, params: { id: route.id } };
    default:
      return { name: route.kind };
  }
}

export function fromScreen(name: string, params?: unknown): Route {
  const id = typeof params === "object" && params !== null ? (params as { id?: unknown }).id : undefined;
  switch (name) {
    case "home":
    case "search":
    case "settings":
    case "accounts":
    case "signIn":
    case "notFound":
      return { kind: name };
    case "library":
    case "item":
    case "play":
      return isId(id) ? { kind: name, id } : { kind: "notFound" };
    default:
      return { kind: "notFound" };
  }
}

/** The player and sign-in show no rail. */
export function chromeOf(route: Route): "rail" | "none" {
  return route.kind === "play" || route.kind === "signIn" ? "none" : "rail";
}

/** A root screen is one a rail entry opens. */
export function isRoot(route: Route): boolean {
  switch (route.kind) {
    case "home":
    case "search":
    case "library":
    case "settings":
    case "accounts":
      return true;
    default:
      return false;
  }
}

/** The rail entry a root route opens. */
export function railKeyOf(route: Route): RailKey | undefined {
  switch (route.kind) {
    case "home":
      return "home";
    case "search":
      return "search";
    case "library":
      return `library:${route.id}`;
    case "settings":
      return "settings";
    case "accounts":
      return "account";
    default:
      return undefined;
  }
}
