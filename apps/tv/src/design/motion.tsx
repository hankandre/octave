// Reduced motion (DESIGN.md §5): the system's "remove animations" setting. The provider reads it once and follows
// `reduceMotionChanged`. A `value` overrides it for tests. It reads `false` until the first read resolves.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo } from "react-native";

const ReducedMotionContext = createContext(false);

export function ReducedMotionProvider({ value, children }: { value?: boolean; children: ReactNode }) {
  const [system, setSystem] = useState(false);
  const overridden = value !== undefined;

  useEffect(() => {
    if (overridden) return undefined;
    let active = true;
    Promise.resolve(AccessibilityInfo.isReduceMotionEnabled())
      .then((enabled) => {
        if (active) setSystem(Boolean(enabled));
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => setSystem(Boolean(enabled)));
    return () => {
      active = false;
      subscription.remove();
    };
  }, [overridden]);

  return <ReducedMotionContext.Provider value={overridden ? value : system}>{children}</ReducedMotionContext.Provider>;
}

export function useReducedMotion(): boolean {
  return useContext(ReducedMotionContext);
}
