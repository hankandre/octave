// The shared focus, press and disabled primitive (DESIGN.md §5, §7.19). A `Pressable` that draws a two-tone focus
// ring while focused, lifts to `motion.lift` over `durQuick`, and scales to `pressScale` over `durInstant` on select.
// With reduced motion on, or in the `still` form for rows and fields (§9, "What lifts"), nothing scales: the ring
// still shows. Every control is built on it.
//
// testIDs: `<testID>` is the Pressable (the element that takes focus and select), `<testID>-scale` the Animated.View
// that holds the children and the transforms (no `transform` at rest), `<testID>-focus-ring` the inner ring, drawn
// only while focused.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Pressable, StyleSheet, View, type AccessibilityRole, type AccessibilityState, type GestureResponderEvent, type StyleProp, type ViewStyle } from "react-native";
import { useReducedMotion } from "./motion";
import { px } from "./scale";
import { colors, focus, motion, radii } from "./tokens";

type FrameState = { focused: boolean; pressed: boolean };

/** The tags of the views each arrow moves focus to, when they are not the nearest ones. */
export type FocusNeighbours = {
  nextFocusUp?: number;
  nextFocusDown?: number;
  nextFocusLeft?: number;
  nextFocusRight?: number;
};

export type FocusFrameProps = FocusNeighbours & {
  testID?: string;
  onPress?: (event: GestureResponderEvent) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  disabled?: boolean;
  /** Never lifts or scales on press: the form of a row or a field. */
  still?: boolean;
  /** Keeps the ring and lift while true, whatever the frame's own focus: a text field holds it while its input has focus. */
  holdFocus?: boolean;
  hasTVPreferredFocus?: boolean;
  /** The pressable's view, for code that has to focus it or point a focus guide at it. */
  viewRef?: (view: unknown) => void;
  /** False takes the control out of focus without changing its look: a control that is fading out. */
  focusable?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  /** A `radii` key: the control's corner, which the ring follows. */
  radius?: keyof typeof radii;
  /** Layout of the pressable itself. */
  style?: StyleProp<ViewStyle>;
  /** The control's own box. It sits on the scaled element, so it lifts with the ring. */
  contentStyle?: StyleProp<ViewStyle>;
  children: ReactNode | ((state: FrameState) => ReactNode);
};

const ringInset = focus.focusOffset + focus.focusRingWidth;
const edgeInset = ringInset + focus.focusEdgeWidth;

/** The two-tone focus ring, drawn whenever it is rendered. It sits outside its parent's box, which the parent must not clip. */
export function FocusRing({ radius, testID }: { radius: keyof typeof radii; testID?: string }) {
  const frameRadius = px(radii[radius]);
  return (
    <>
      <View pointerEvents="none" style={[styles.overlay, styles.edge, { borderRadius: frameRadius + edgeInset }]} />
      <View testID={testID} pointerEvents="none" style={[styles.overlay, styles.ring, { borderRadius: frameRadius + ringInset }]} />
    </>
  );
}

export function FocusFrame({
  testID,
  onPress,
  onFocus,
  onBlur,
  disabled = false,
  still = false,
  holdFocus = false,
  hasTVPreferredFocus,
  viewRef,
  focusable = true,
  nextFocusUp,
  nextFocusDown,
  nextFocusLeft,
  nextFocusRight,
  accessibilityLabel,
  accessibilityRole,
  accessibilityState,
  radius = "radiusControl",
  style,
  contentStyle,
  children,
}: FocusFrameProps) {
  const reduced = useReducedMotion();
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [lifted, setLifted] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;
  const liftedRef = useRef(false);
  const lastChange = useRef<"focus" | "press">("focus");

  const isFocused = focused || holdFocus;
  const motionless = reduced || still;
  const target = motionless ? 1 : (isFocused ? motion.lift : 1) * (pressed ? motion.pressScale : 1);

  useEffect(() => {
    if (motionless) {
      scale.stopAnimation();
      scale.setValue(1);
      liftedRef.current = false;
      setLifted(false);
      return undefined;
    }
    if (target === 1 && !liftedRef.current) return undefined;
    liftedRef.current = true;
    setLifted(true);
    const animation = Animated.timing(scale, {
      toValue: target,
      duration: lastChange.current === "press" ? motion.durInstant : motion.durQuick,
      easing: Easing.bezier(...motion.easeOut),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && target === 1) {
        liftedRef.current = false;
        setLifted(false);
      }
    });
    return () => animation.stop();
  }, [target, motionless, scale]);

  const showRing = isFocused && !disabled;

  return (
    <Pressable
      ref={viewRef}
      testID={testID}
      nextFocusUp={nextFocusUp}
      nextFocusDown={nextFocusDown}
      nextFocusLeft={nextFocusLeft}
      nextFocusRight={nextFocusRight}
      focusable={focusable && !disabled}
      disabled={disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ ...accessibilityState, disabled }}
      style={style}
      onPress={(event) => {
        if (disabled) return;
        onPress?.(event);
      }}
      onFocus={() => {
        if (disabled) return;
        lastChange.current = "focus";
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => {
        lastChange.current = "focus";
        setFocused(false);
        onBlur?.();
      }}
      onPressIn={() => {
        if (disabled) return;
        lastChange.current = "press";
        setPressed(true);
      }}
      onPressOut={() => {
        lastChange.current = "press";
        setPressed(false);
      }}
    >
      <Animated.View testID={testID ? `${testID}-scale` : undefined} style={[contentStyle, lifted && !motionless ? { transform: [{ scale }] } : undefined]}>
        {typeof children === "function" ? children({ focused: showRing, pressed }) : children}
        {showRing ? <FocusRing radius={radius} testID={testID ? `${testID}-focus-ring` : undefined} /> : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: { position: "absolute" },
  ring: {
    top: -px(ringInset),
    right: -px(ringInset),
    bottom: -px(ringInset),
    left: -px(ringInset),
    borderColor: colors.focus,
    borderWidth: px(focus.focusRingWidth),
  },
  edge: {
    top: -px(edgeInset),
    right: -px(edgeInset),
    bottom: -px(edgeInset),
    left: -px(edgeInset),
    borderColor: colors.focusEdge,
    borderWidth: px(focus.focusEdgeWidth),
  },
});
