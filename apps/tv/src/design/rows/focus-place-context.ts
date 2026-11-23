// Where a screen reports its focus (T3-09). The shell provides a reporter per screen so it can return focus to the same card
// after Back and to the last content element when Right leaves the rail. With no shell the reporter does nothing, so a
// `RowList` renders unchanged without a navigator. Views are held, never ids of users or tokens.
import { createContext, useContext } from "react";

export type RowsHandle = {
  /** Point every row's focus guide at nothing, so a later move into the rows is not sent to a stale card. */
  clear(): void;
  viewOf(rowId: string, itemId: string): unknown;
  rows(): { id: string; items: { id: string }[] }[];
};

export type FocusReporter = {
  focused(key: string, view: unknown, card?: { rowId: string; itemId: string; index: number }): void;
  opening(view: unknown): void;
  rows(handle: RowsHandle | null): void;
};

const silent: FocusReporter = {
  focused() {},
  opening() {},
  rows() {},
};

export const FocusPlaceContext = createContext<FocusReporter>(silent);

export function useFocusPlace(): FocusReporter {
  return useContext(FocusPlaceContext);
}
