// The only shell code that touches a view's native tag, its imperative focus or a guide's destinations (T3-09). Tests replace
// this module with a double that records the calls.
import { findNodeHandle } from "react-native";

type Focusable = { requestTVFocus?: () => void };
type Guide = { setDestinations?: (destinations: unknown[]) => void };

/** The native tag of a view, or `undefined` when there is none. */
export function tagOf(view: unknown): number | undefined {
  if (view === null || view === undefined) return undefined;
  return findNodeHandle(view as Parameters<typeof findNodeHandle>[0]) ?? undefined;
}

/** Move focus to a view. */
export function focusView(view: unknown): void {
  (view as Focusable | null | undefined)?.requestTVFocus?.();
}

/** Tell a focus guide which views receive focus when it is entered. */
export function pointGuide(guide: unknown, views: unknown[]): void {
  (guide as Guide | null | undefined)?.setDestinations?.(views);
}
