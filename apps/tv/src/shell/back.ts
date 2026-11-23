// What Back does (T3-09 item 5, DESIGN.md §6 and §9), as a pure rule. On a root screen the first Back opens the rail; with the
// rail open, Back on Home leaves the app and Back on another root screen goes Home. Nothing here asks a question.
import { isRoot, type Route } from "./routes";

export type BackDecision = "open-rail" | "close-rail" | "pop" | "go-home" | "exit";

export function decideBack({ route, depth, railOpen }: { route: Route; depth: number; railOpen: boolean }): BackDecision {
  if (isRoot(route)) {
    if (!railOpen) return "open-rail";
    return route.kind === "home" ? "exit" : "go-home";
  }
  if (route.kind === "item") {
    if (railOpen) return "close-rail";
    return depth > 1 ? "pop" : "go-home";
  }
  return depth > 1 ? "pop" : "go-home";
}
