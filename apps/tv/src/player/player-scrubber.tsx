// The scrubber (DESIGN.md §7.14 item 2): elapsed time, the track with the buffered range and the played fill, and the
// time remaining. Focus shows as a thicker track and a 24 px thumb with the two-tone focus ring; the scrubber is a row, so
// nothing lifts (T8-27 D2). It reads the position
// itself, so the engine's one-second events redraw nothing else. While a seek has not landed it shows its target.
// TalkBack hears the times when it takes focus and when a seek lands, not every second.
//
// testIDs: player-scrubber (the zone), player-scrubber-track, player-scrubber-buffered, player-scrubber-fill,
// player-scrubber-thumb, player-scrubber-thumb-focus-ring.
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, type DimensionValue } from "react-native";
import { FocusRing, type FocusNeighbours } from "../design/focus-frame";
import { px } from "../design/scale";
import { textStyle } from "../design/text";
import { artDefaults, colors, radii, sizes, space } from "../design/tokens";
import type { PlayerServices } from "./player-services";
import { playerTime, remainingTime } from "./player-time";
import { useViewingValue } from "./use-viewing-value";

const STEP_ACTIONS = [{ name: "increment" }, { name: "decrement" }];

export type PlayerScrubberProps = FocusNeighbours & {
  viewing: PlayerServices["viewing"];
  focusable: boolean;
  viewRef: (view: unknown) => void;
  onPress: () => void;
  /** TalkBack's increase and decrease actions: one step forward or back. */
  onStep: (command: "seek-back" | "seek-forward") => void;
  onFocus: () => void;
  onBlur: () => void;
};

const shareOf = (seconds: number, duration: number | undefined): DimensionValue => {
  if (duration === undefined || duration <= 0) return "0%";
  return `${Math.min(100, Math.max(0, (seconds / duration) * 100))}%`;
};

export function PlayerScrubber({ viewing, viewRef, onStep, onFocus, onBlur, ...pressable }: PlayerScrubberProps) {
  const position = useViewingValue(viewing, (state) => state.session.snapshot?.positionSeconds ?? 0);
  const duration = useViewingValue(viewing, (state) => state.session.snapshot?.durationSeconds);
  const buffered = useViewingValue(viewing, (state) => state.session.snapshot?.bufferedSeconds ?? 0);
  const seekingTo = useViewingValue(viewing, (state) => state.seekingTo);
  const [focused, setFocused] = useState(false);
  const shownPosition = seekingTo ?? position;

  const elapsed = playerTime(shownPosition);
  const remaining = duration === undefined ? undefined : remainingTime(shownPosition, duration);
  const times = remaining === undefined ? elapsed : `${elapsed}, ${remaining}`;
  const latestTimes = useRef(times);
  latestTimes.current = times;
  const [spokenTimes, setSpokenTimes] = useState(times);

  useEffect(() => {
    if (seekingTo === undefined) setSpokenTimes(latestTimes.current);
  }, [seekingTo]);

  return (
    <View testID="player-scrubber" style={styles.zone}>
      <Pressable
        {...pressable}
        ref={viewRef}
        accessibilityRole="adjustable"
        accessibilityLabel="Seek"
        accessibilityValue={{ text: spokenTimes }}
        accessibilityActions={STEP_ACTIONS}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === "increment") onStep("seek-forward");
          if (nativeEvent.actionName === "decrement") onStep("seek-back");
        }}
        onFocus={() => {
          setFocused(true);
          setSpokenTimes(latestTimes.current);
          onFocus();
        }}
        onBlur={() => {
          setFocused(false);
          onBlur();
        }}
        style={styles.row}
      >
        <Text style={styles.time}>{elapsed}</Text>
        <View style={styles.rail}>
          <View testID="player-scrubber-track" style={[styles.track, focused ? styles.trackFocused : undefined]}>
            <View testID="player-scrubber-buffered" style={[styles.range, styles.buffered, { width: shareOf(buffered, duration) }]} />
            <View testID="player-scrubber-fill" style={[styles.range, styles.fill, { width: shareOf(shownPosition, duration) }]} />
          </View>
          {focused && duration !== undefined ? (
            <View testID="player-scrubber-thumb" style={[styles.thumb, { left: shareOf(shownPosition, duration) }]}>
              <FocusRing radius="radiusPill" testID="player-scrubber-thumb-focus-ring" />
            </View>
          ) : null}
        </View>
        {remaining === undefined ? null : <Text style={styles.time}>{remaining}</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  zone: { alignSelf: "stretch" },
  row: { flexDirection: "row", alignItems: "center", gap: px(space.space5), minHeight: px(sizes.hitMin) },
  time: { ...textStyle("typeMono"), color: colors.text1 },
  rail: { flex: 1, justifyContent: "center", height: px(sizes.scrubThumb) },
  track: { height: px(sizes.scrubTrackH), borderRadius: px(radii.radiusPill), backgroundColor: colors.track, overflow: "hidden" },
  trackFocused: { height: px(sizes.scrubTrackHActive) },
  range: { position: "absolute", top: 0, bottom: 0, left: 0 },
  buffered: { backgroundColor: colors.trackBuffered },
  fill: { backgroundColor: artDefaults.artAccent },
  thumb: {
    position: "absolute",
    width: px(sizes.scrubThumb),
    height: px(sizes.scrubThumb),
    marginLeft: -px(sizes.scrubThumb / 2),
    borderRadius: px(radii.radiusPill),
    backgroundColor: colors.text1,
  },
});
