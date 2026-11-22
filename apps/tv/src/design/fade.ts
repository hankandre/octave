// The fade of Dialog and Toast (DESIGN.md §5): opacity 0 to 1 over `durBase` with `easeOut` on show, and the reverse
// on hide. Under reduced motion there is no fade: the element is at full opacity at once and is removed at once.
import { useEffect, useRef, useState } from "react";
import { Animated, Easing } from "react-native";
import { useReducedMotion } from "./motion";
import { motion } from "./tokens";

/** `show` says whether to render; `opacity` is the value for the faded element's style. */
export function useFade(visible: boolean): { show: boolean; opacity: Animated.Value | number } {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(visible && !reduced ? 0 : 1)).current;
  const [leaving, setLeaving] = useState(false);
  const wasVisible = useRef(visible);

  useEffect(() => {
    if (reduced) {
      value.stopAnimation();
      value.setValue(1);
      setLeaving(false);
      wasVisible.current = visible;
      return undefined;
    }
    const entering = visible && !wasVisible.current;
    const leave = !visible && wasVisible.current;
    wasVisible.current = visible;
    if (!visible && !leave) return undefined;
    if (leave) setLeaving(true);
    if (entering) value.setValue(0);
    const animation = Animated.timing(value, {
      toValue: visible ? 1 : 0,
      duration: motion.durBase,
      easing: Easing.bezier(...motion.easeOut),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !visible) setLeaving(false);
    });
    return () => animation.stop();
  }, [visible, reduced, value]);

  return { show: visible || (leaving && !reduced), opacity: reduced ? 1 : value };
}
