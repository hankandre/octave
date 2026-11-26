// The player's status (DESIGN.md §7.14, T8-04 D8). Before the first frame an opaque layer covers the empty surface: the
// item's backdrop under both player scrims, the top bar, and one line that says only what is known. After it,
// "Buffering…" shows once the picture has waited `bufferingDelayMs`. The disc's ring turns until T3-35 builds the
// loader; with reduced motion it stands still.
//
// testIDs: player-loading, player-buffering, player-status-ring.
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import type { ImageRef } from "@octave/core/src/domain/catalog";
import type { ViewingState } from "@octave/core/src/player/viewing";
import { useReducedMotion } from "../design/motion";
import { useArtwork } from "../design/rows/artwork";
import { px } from "../design/scale";
import { scrimStyle } from "../design/scrim";
import { textStyle } from "../design/text";
import { backdropArt, canvas, colors, motion, radii, sizes, space } from "../design/tokens";
import type { PlayerServices } from "./player-services";
import { PlayerTopBar, type TopBarBack } from "./player-top-bar";
import { useViewingValue } from "./use-viewing-value";

// One turn of the ring.
const TURN_MS = motion.durSlow * 2;

function Ring() {
  const reduced = useReducedMotion();
  const turn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      turn.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: TURN_MS, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduced, turn]);

  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return <Animated.View testID="player-status-ring" style={[styles.ring, { transform: [{ rotate }] }]} />;
}

function Status({ line }: { line: string }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.centre]} accessibilityLiveRegion="polite">
      <View style={styles.disc}>
        <Ring />
      </View>
      <Text style={styles.line}>{line}</Text>
    </View>
  );
}

function Backdrop({ image }: { image: ImageRef }) {
  const { component: Artwork } = useArtwork();
  const [failed, setFailed] = useState(false);
  if (Artwork === undefined || failed) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop]}>
      <Artwork image={image} width={canvas.width} height={canvas.height} onFailed={() => setFailed(true)} />
    </View>
  );
}

const openingLine = (opening: ViewingState["opening"]): string => (opening === "original" ? "Opening the original file…" : "Loading…");

export function PlayerLoading({ viewing, back }: { viewing: PlayerServices["viewing"]; back: TopBarBack }) {
  const title = useViewingValue(viewing, (state) => state.title);
  const backdrop = useViewingValue(viewing, (state) => state.backdrop);
  const opening = useViewingValue(viewing, (state) => state.opening);
  return (
    <View testID="player-loading" style={[StyleSheet.absoluteFill, styles.layer]}>
      {backdrop === undefined ? null : <Backdrop key={backdrop.tag} image={backdrop} />}
      <View pointerEvents="none" style={[styles.floor, scrimStyle("scrimPlayerBottom", "to top")]} />
      <PlayerTopBar title={title} back={back} />
      <Status line={openingLine(opening)} />
    </View>
  );
}

/** True once `waiting` has held for `bufferingDelayMs`, until it stops holding. */
function useLate(waiting: boolean): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setTimeout(() => setLate(true), motion.bufferingDelayMs);
    return () => {
      clearTimeout(timer);
      setLate(false);
    };
  }, [waiting]);
  return waiting && late;
}

export function PlayerBuffering({ viewing }: { viewing: PlayerServices["viewing"] }) {
  const buffering = useViewingValue(viewing, (state) => state.phase === "playing" && state.session.snapshot?.buffering === true);
  if (!useLate(buffering)) return null;
  return (
    <View testID="player-buffering" pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Status line="Buffering…" />
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { backgroundColor: colors.void },
  backdrop: { opacity: backdropArt.playerOpacity },
  floor: { position: "absolute", bottom: 0, left: 0, right: 0, height: px(sizes.scrimPlayerBottomH) },
  centre: { alignItems: "center", justifyContent: "center", gap: px(space.space4) },
  disc: {
    width: px(sizes.playerStatusDisc),
    height: px(sizes.playerStatusDisc),
    borderRadius: px(radii.radiusPill),
    backgroundColor: colors.surface1,
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    width: px(space.space7),
    height: px(space.space7),
    borderRadius: px(radii.radiusPill),
    borderWidth: px(space.space1),
    borderColor: colors.track,
    borderTopColor: colors.text1,
  },
  line: {
    ...textStyle("typeBody"),
    color: colors.text1,
    paddingHorizontal: px(space.space5),
    borderRadius: px(radii.radiusPill),
    backgroundColor: colors.surface1,
  },
});
