// The first step's focusable controls, and the one way it sends focus to one of them (T4-02 D3).
import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerRow } from "@octave/core/src/domain/server-choice";
import { focusView } from "../shell/focus-bridge";

export type ControlId = "field" | "search" | `row:${string}`;

export const rowControl = (server: Pick<ServerRow, "id" | "address">): ControlId => `row:${server.id}|${server.address}`;

/** `register` gives a control's ref callback; `focus` moves to it once it has been drawn. */
export function useControlFocus() {
  const views = useRef(new Map<ControlId, unknown>());
  const callbacks = useRef(new Map<ControlId, (view: unknown) => void>());
  const [request, setRequest] = useState<{ control: ControlId } | undefined>(undefined);

  const register = useCallback((control: ControlId) => {
    const known = callbacks.current.get(control);
    if (known !== undefined) return known;
    const callback = (view: unknown) => {
      views.current.set(control, view);
    };
    callbacks.current.set(control, callback);
    return callback;
  }, []);

  const focus = useCallback((control: ControlId) => setRequest({ control }), []);

  useEffect(() => {
    if (request !== undefined) focusView(views.current.get(request.control));
  }, [request]);

  return { register, focus };
}
