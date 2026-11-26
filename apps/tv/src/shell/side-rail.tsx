// The collapsed side rail (T3-09, DESIGN.md §7.1) with decision 0004's measured focus fixes. It sits over the content at the
// left: `railCollapsedW` wide with icons, `railOpenW` wide with labels while an entry has focus. Its focus guide traps Left,
// Up and Down and never Right, so Left stays on the rail and Right leaves it. While the rail is open, every entry's
// `nextFocusRight` is the tag of the content element that had focus before (`returnTag`), as the spike measured.
//
// The rail opens when any entry takes focus and closes when focus leaves every entry: a blur schedules a zero-delay check
// that another entry's focus cancels. The icons come from a slot (`RailIconsProvider`), filled by shell/rail-icons.ts.
//
// A focused entry is a row (T3-40, DESIGN.md §9): the ring and a `surface3` fill, never a lift. The entries sit 16 canvas
// px from the rail's four edges. The room for each ring is inside the box that would clip it, the scrolling list included
// (shell/use-rail-reveal.ts).
//
// testIDs, with t the rail's testID: t, rail-guide, rail-entry-<key> (":" written "-"), rail-entry-<key>-label (open only)
// and rail-entry-<key>-bar (the current entry only).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Animated, Easing, ScrollView, StyleSheet, Text, TVFocusGuideView, View } from "react-native";
import { FocusFrame } from "../design/focus-frame";
import type { IconComponent } from "../design/icon";
import { useReducedMotion } from "../design/motion";
import { px } from "../design/scale";
import { textStyle } from "../design/text";
import { colors, motion, radii, sizes, space } from "../design/tokens";
import type { RailEntry, RailIconName, RailKey } from "./rail-entries";
import { useRailReveal } from "./use-rail-reveal";

export type RailIcons = Partial<Record<RailIconName, IconComponent>>;

const RailIconsContext = createContext<RailIcons>({});

export function RailIconsProvider({ icons, children }: { icons?: RailIcons; children: ReactNode }): ReactElement {
  return <RailIconsContext.Provider value={icons ?? {}}>{children}</RailIconsContext.Provider>;
}

export type SideRailProps = {
  entries: RailEntry[];
  current: RailKey;
  onSelect(entry: RailEntry): void;
  /** The native tag of the content element that had focus; entries send Right there while the rail is open. */
  returnTag?: number;
  onOpenChange(open: boolean): void;
  registerEntry(key: RailKey, view: unknown): void;
  testID: string;
};

const idOf = (key: RailKey): string => `rail-entry-${key.replace(":", "-")}`;
const ICON = space.space6;
const EDGE_PAD = (sizes.railCollapsedW - sizes.hitMin) / 2;
/** The scrolling list's padding above and below its entries: room for a ring, which the list would otherwise clip. */
const LIST_ROOM = space.space2;

type ItemProps = {
  entry: RailEntry;
  selected: boolean;
  open: boolean;
  nextFocusRight?: number;
  onFocus(key: RailKey): void;
  onBlur(): void;
  onPress(entry: RailEntry): void;
  registerEntry(key: RailKey, view: unknown): void;
};

function RailItem({ entry, selected, open, nextFocusRight, onFocus, onBlur, onPress, registerEntry }: ItemProps): ReactElement {
  const icons = useContext(RailIconsContext);
  const Icon = icons[entry.icon];
  const id = idOf(entry.key);
  const key = entry.key;
  const viewRef = useCallback((view: unknown) => registerEntry(key, view), [registerEntry, key]);
  const [isFocused, setFocused] = useState(false);
  return (
    <FocusFrame
      testID={id}
      viewRef={viewRef}
      nextFocusRight={nextFocusRight}
      radius="radiusControl"
      accessibilityRole="button"
      accessibilityLabel={entry.label}
      accessibilityState={{ selected }}
      still
      onFocus={() => {
        setFocused(true);
        onFocus(key);
      }}
      onBlur={() => {
        setFocused(false);
        onBlur();
      }}
      onPress={() => onPress(entry)}
      contentStyle={[styles.entry, isFocused ? styles.entryFocused : undefined]}
    >
      {({ focused }) => {
        const colour = focused || selected ? colors.text1 : colors.text2;
        return (
          <>
            {selected ? <View testID={`${id}-bar`} style={styles.bar} /> : null}
            <View style={styles.iconCell}>
              {entry.initial !== undefined ? (
                <Text style={[styles.initial, { color: colour }]}>{entry.initial}</Text>
              ) : Icon !== undefined ? (
                <Icon size={px(ICON)} color={colour} />
              ) : null}
            </View>
            {open ? (
              <Text testID={`${id}-label`} numberOfLines={1} style={[styles.label, { color: colour }]}>
                {entry.label}
              </Text>
            ) : null}
          </>
        );
      }}
    </FocusFrame>
  );
}

export function SideRail({ entries, current, onSelect, returnTag, onOpenChange, registerEntry, testID }: SideRailProps): ReactElement {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ onOpenChange });
  latest.current = { onOpenChange };

  const change = useCallback((next: boolean) => {
    if (openRef.current === next) return;
    openRef.current = next;
    setOpen(next);
    latest.current.onOpenChange(next);
  }, []);
  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const { listProps, entryFocused, entryLaidOut } = useRailReveal(px(LIST_ROOM));
  const onFocus = useCallback(
    (key: RailKey) => {
      cancel();
      change(true);
      entryFocused(key);
    },
    [cancel, change, entryFocused],
  );
  const onBlur = useCallback(() => {
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      change(false);
    }, 0);
  }, [cancel, change]);
  useEffect(() => cancel, [cancel]);

  const onPress = useCallback(
    (entry: RailEntry) => {
      if (entry.key === current) {
        cancel();
        change(false);
      }
      onSelect(entry);
    },
    [cancel, change, current, onSelect],
  );

  const target = px(open ? sizes.railOpenW : sizes.railCollapsedW);
  const width = useRef(new Animated.Value(target)).current;
  useEffect(() => {
    if (reduced) {
      width.stopAnimation();
      width.setValue(target);
      return undefined;
    }
    const animation = Animated.timing(width, { toValue: target, duration: motion.durQuick, easing: Easing.bezier(...motion.easeOut), useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [target, reduced, width]);

  const item = (entry: RailEntry): ReactElement => (
    <RailItem
      key={entry.key}
      entry={entry}
      selected={entry.key === current}
      open={open}
      nextFocusRight={open ? returnTag : undefined}
      onFocus={onFocus}
      onBlur={onBlur}
      onPress={onPress}
      registerEntry={registerEntry}
    />
  );
  const top = entries.filter((entry) => entry.key === "search");
  const middle = entries.filter((entry) => entry.key !== "search" && entry.key !== "settings" && entry.key !== "account");
  const bottom = entries.filter((entry) => entry.key === "settings" || entry.key === "account");

  return (
    <Animated.View
      testID={testID}
      role="navigation"
      accessibilityLabel="Main"
      style={[styles.rail, { width: reduced ? target : width, backgroundColor: open ? colors.surface1 : undefined }]}
    >
      <TVFocusGuideView testID="rail-guide" trapFocusLeft trapFocusUp trapFocusDown style={styles.guide}>
        <View style={styles.group}>{top.map(item)}</View>
        <ScrollView {...listProps} style={styles.scroll} contentContainerStyle={[styles.group, styles.list]} showsVerticalScrollIndicator={false}>
          {middle.map((entry) => (
            <View key={entry.key} onLayout={(event) => entryLaidOut(entry.key, event.nativeEvent.layout.y)}>
              {item(entry)}
            </View>
          ))}
        </ScrollView>
        <View style={styles.group}>{bottom.map(item)}</View>
      </TVFocusGuideView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  rail: { position: "absolute", top: 0, bottom: 0, left: 0, zIndex: 2, overflow: "hidden" },
  guide: { flex: 1, paddingVertical: px(EDGE_PAD) },
  scroll: { flex: 1 },
  // The side padding is on each group and not the guide, so the list spans the rail and its clip clears the rings.
  group: { gap: px(space.space2), paddingHorizontal: px(EDGE_PAD) },
  list: { paddingVertical: px(LIST_ROOM) },
  entry: { height: px(sizes.hitMin), minWidth: px(sizes.hitMin), flexDirection: "row", alignItems: "center", borderRadius: px(radii.radiusControl) },
  entryFocused: { backgroundColor: colors.surface3 },
  iconCell: { width: px(sizes.hitMin), height: px(sizes.hitMin), alignItems: "center", justifyContent: "center" },
  initial: textStyle("typeLabel"),
  label: { ...textStyle("typeLabel"), flex: 1, paddingRight: px(space.space4) },
  bar: { position: "absolute", left: 0, top: px(space.space3), bottom: px(space.space3), width: px(space.space1), backgroundColor: colors.text1 },
});
