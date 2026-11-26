// What a screen can ask of the shell (T3-09): open a route, read the top one and close it. A root route resets the stack;
// any other pushes; close pops the top screen as Back does. Screens never touch a navigation API.
import { createContext, useContext } from "react";
import type { Route } from "./routes";

export type ShellApi = { open(route: Route): void; route: Route; close?(): void };

export const ShellContext = createContext<ShellApi>({
  open() {},
  route: { kind: "home" },
});

export function useShell(): ShellApi {
  return useContext(ShellContext);
}
