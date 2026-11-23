// What a screen can ask of the shell (T3-09): open a route and read the top one. A root route resets the stack; any other
// pushes. Screens never touch a navigation API.
import { createContext, useContext } from "react";
import type { Route } from "./routes";

export type ShellApi = { open(route: Route): void; route: Route };

export const ShellContext = createContext<ShellApi>({
  open() {},
  route: { kind: "home" },
});

export function useShell(): ShellApi {
  return useContext(ShellContext);
}
