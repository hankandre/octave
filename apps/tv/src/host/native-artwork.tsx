// Fills T3-08's artwork slot with the native artwork view (T3-11, T3-39; docs/specs/T3-11.md, "The JavaScript surface",
// and docs/specs/T3-39.md, "The JavaScript side"). Inside a plain surface2 wrapper it draws, in this order:
// - when the image has a non-empty BlurHash, a preview view that gets that hash string and nothing else; the native side
//   validates and decodes it and draws a blurred preview, or nothing for a hash it refuses;
// - the picture view, which gets the opaque session id, the image's item id, type and tag, and the drawn width in whole
//   canvas px as drawnWidth (T3-42: never `width`, which React Native's layout reads as dp): never a URL, header,
//   token, BlurHash or height.
// With a preview the picture fades in over it on "loaded" (DESIGN.md §5 and §7.5: durSlow with easeInOut, or
// reducedMotion.durSlow under reduced motion, opacity only); with none it shows at once, as in T3-11. A failed image
// calls the slot's onFailed, so the card shows its title. With no session nothing is drawn and the slot fails at once.
// The picture is keyed by its five props, so a new image remounts it, and a failure reported for an image the slot no
// longer shows is ignored.
import type { ArtworkImageType, OctaveArtworkViewProps } from "@octave/artwork";
import { memo, useCallback, useEffect, useRef, type ComponentProps, type ComponentType } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import type { ArtworkComponent } from "../design/rows/artwork";
import { useReducedMotion } from "../design/motion";
import { colors, motion, reducedMotion } from "../design/tokens";

export type NativeArtworkOptions = {
  /** The native view: loadArtworkView() in the app, a fake in tests. */
  view: ComponentType<OctaveArtworkViewProps>;
  /** The signed-in session's opaque id, or undefined when signed out. */
  session: () => string | undefined;
};

type StateEvent = Parameters<NonNullable<OctaveArtworkViewProps["onArtworkState"]>>[0];

type PictureProps = {
  NativeView: ComponentType<OctaveArtworkViewProps>;
  session: string;
  itemId: string;
  imageType: ArtworkImageType;
  tag: string;
  drawnWidth: number;
  /** Whether a preview is drawn beneath, so the picture fades in over it. */
  fades: boolean;
  onArtworkState: (event: StateEvent) => void;
};

function Picture({ NativeView, session, itemId, imageType, tag, drawnWidth, fades, onArtworkState }: PictureProps) {
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(fades ? 0 : 1)).current;
  const shown = useRef(!fades);
  const animation = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => () => animation.current?.stop(), []);

  const onState = useCallback(
    (event: StateEvent) => {
      if (event.nativeEvent.state === "loaded" && !shown.current) {
        shown.current = true;
        animation.current = Animated.timing(opacity, {
          toValue: 1,
          duration: reduced ? reducedMotion.durSlow : motion.durSlow,
          easing: Easing.bezier(...motion.easeInOut),
          useNativeDriver: true,
        });
        animation.current.start();
      }
      onArtworkState(event);
    },
    [onArtworkState, opacity, reduced],
  );

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
      <NativeView
        session={session}
        itemId={itemId}
        imageType={imageType}
        tag={tag}
        drawnWidth={drawnWidth}
        onArtworkState={onState}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

export function createNativeArtwork({ view: NativeView, session }: NativeArtworkOptions): ArtworkComponent {
  function NativeArtwork({ image, width, onFailed, testID }: ComponentProps<ArtworkComponent>) {
    const id = session();
    const drawn = Math.round(width);
    const key = id === undefined ? undefined : `${id}/${image.itemId}/${image.type}/${image.tag}/${drawn}`;
    const hash = typeof image.blurHash === "string" && image.blurHash.length > 0 ? image.blurHash : undefined;
    const failed = useRef(onFailed);
    failed.current = onFailed;
    const shown = useRef(key);
    shown.current = key;

    useEffect(() => {
      if (id === undefined) failed.current();
    }, [id]);

    const onArtworkState = useCallback(
      (event: StateEvent) => {
        if (event.nativeEvent.state === "failed" && shown.current === key) failed.current();
      },
      [key],
    );

    return (
      <View testID={testID} style={styles.placeholder}>
        {id === undefined || hash === undefined ? null : (
          <NativeView key={`preview/${hash}`} blurHash={hash} style={StyleSheet.absoluteFill} />
        )}
        {id === undefined ? null : (
          <Picture
            key={key}
            NativeView={NativeView}
            session={id}
            itemId={image.itemId}
            imageType={image.type}
            tag={image.tag}
            drawnWidth={drawn}
            fades={hash !== undefined}
            onArtworkState={onArtworkState}
          />
        )}
      </View>
    );
  }
  return memo(NativeArtwork);
}

const styles = StyleSheet.create({
  placeholder: { flex: 1, backgroundColor: colors.surface2 },
});
