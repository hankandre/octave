// The views the player moves focus to, by name. A view's tag is known only once it is mounted, so a new view draws the
// screen again to name it as a neighbour. A view that unmounts is kept until another takes its name: nothing asks for it.
import { useCallback, useRef, useState } from "react";
import { focusView, tagOf } from "../shell/focus-bridge";

export type Views<Name extends string> = {
  /** The ref callback for a name; the same function on every render. */
  ref(name: Name): (view: unknown) => void;
  tag(name: Name): number | undefined;
  focus(name: Name): void;
};

export function useViews<Name extends string>(): Views<Name> {
  const nodes = useRef(new Map<Name, unknown>());
  const callbacks = useRef(new Map<Name, (view: unknown) => void>());
  const [, setMounted] = useState(0);

  const ref = useCallback((name: Name) => {
    const known = callbacks.current.get(name);
    if (known !== undefined) return known;
    const callback = (view: unknown) => {
      if (view === null || nodes.current.get(name) === view) return;
      nodes.current.set(name, view);
      setMounted((count) => count + 1);
    };
    callbacks.current.set(name, callback);
    return callback;
  }, []);
  const tag = useCallback((name: Name) => tagOf(nodes.current.get(name)), []);
  const focus = useCallback((name: Name) => focusView(nodes.current.get(name)), []);
  return { ref, tag, focus };
}

/** Every arrow names the view itself: a layer with one control, and the focus holder. */
export function trapped(tag: number | undefined) {
  return { nextFocusUp: tag, nextFocusDown: tag, nextFocusLeft: tag, nextFocusRight: tag };
}
