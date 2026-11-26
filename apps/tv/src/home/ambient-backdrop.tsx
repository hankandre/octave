// The ambient backdrop (DESIGN.md §7.2, T5-03 D10): the focused title's backdrop at low opacity under the hero scrim and the
// floor scrim, behind Home's content. A change of art arrives through `useDwell` (the 300 ms pause), then the new layer fades
// in over the old for `motion.durSlow`, and the old layer is dropped when the fade ends. Under reduced motion the old layer is
// replaced in the same render and nothing animates. A target with no art shows none: the layer never keeps another title's picture.
//
// testIDs: home-backdrop (the layer), home-backdrop-layer-<n> (one fade), home-backdrop-artwork-<n> (its artwork slot).
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import type { ImageRef } from "@octave/core/src/domain/catalog";
import { useReducedMotion } from "../design/motion";
import { useArtwork } from "../design/rows";
import { scrimStyle } from "../design/scrim";
import { backdropArt, canvas, motion } from "../design/tokens";
import { useDwell } from "./use-dwell";

type Layer = { id: number; image: ImageRef; fade: boolean };

function BackdropLayer({ layer, onFaded, onFailed }: { layer: Layer; onFaded: (id: number) => void; onFailed: (id: number) => void }) {
  const { component: Artwork } = useArtwork();
  const opacity = useRef(new Animated.Value(layer.fade ? 0 : 1)).current;
  useEffect(() => {
    if (!layer.fade) return undefined;
    const fade = Animated.timing(opacity, { toValue: 1, duration: motion.durSlow, easing: Easing.bezier(...motion.easeInOut), useNativeDriver: true });
    fade.start(({ finished }) => {
      if (finished) onFaded(layer.id);
    });
    return () => fade.stop();
  }, [layer.fade, layer.id, onFaded, opacity]);
  if (Artwork === undefined) return null;
  return (
    <Animated.View testID={`home-backdrop-layer-${layer.id}`} pointerEvents="none" style={[styles.fill, { opacity }]}>
      <Artwork image={layer.image} width={canvas.width} height={canvas.height} onFailed={() => onFailed(layer.id)} testID={`home-backdrop-artwork-${layer.id}`} />
    </Animated.View>
  );
}

export function AmbientBackdrop({ target }: { target: ImageRef | undefined }) {
  const reduced = useReducedMotion();
  const settled = useDwell(target, motion.dwellMs);
  const next = useRef(1);
  const shown = useRef<ImageRef | undefined>(undefined);
  const [layers, setLayers] = useState<Layer[]>(() => {
    shown.current = settled;
    return settled === undefined ? [] : [{ id: 0, image: settled, fade: false }];
  });

  useEffect(() => {
    if (Object.is(shown.current, settled)) return;
    shown.current = settled;
    if (settled === undefined) {
      setLayers([]);
      return;
    }
    const layer: Layer = { id: next.current, image: settled, fade: !reduced };
    next.current += 1;
    setLayers((current) => (reduced ? [layer] : [...current, layer]));
  }, [settled, reduced]);

  const dropOlder = useCallback((id: number) => setLayers((current) => current.filter((layer) => layer.id >= id)), []);
  // A failed layer takes every older one with it: the backdrop never keeps another title's picture.
  const drop = useCallback((id: number) => setLayers((current) => current.filter((layer) => layer.id > id)), []);

  return (
    <View testID="home-backdrop" pointerEvents="none" style={styles.fill}>
      <View pointerEvents="none" style={styles.art}>
        {layers.map((layer) => (
          <BackdropLayer key={layer.id} layer={layer} onFaded={dropOlder} onFailed={drop} />
        ))}
      </View>
      <View style={[styles.fill, scrimStyle("scrimHero", "to right")]} />
      <View style={[styles.fill, scrimStyle("scrimFloor", "to top")]} />
    </View>
  );
}

const fill = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;

const styles = StyleSheet.create({
  fill,
  art: { ...fill, opacity: backdropArt.opacity },
});
