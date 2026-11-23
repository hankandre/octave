// Whether Left on a row's first card is held (`trap`) or leaves for the rail (`open`). The app shell provides `open` over its
// content; with no shell, rows trap Left (T3-08).
import { createContext } from "react";

export type LeftEdge = "trap" | "open";

export const LeftEdgeContext = createContext<LeftEdge>("trap");
