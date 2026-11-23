// Fills T3-08's artwork slot with the native artwork view (T3-11; docs/specs/T3-11.md, "The JavaScript surface"). The
// view gets the opaque session id, the image's item id, type and tag, and the drawn width in whole canvas px: never a
// URL, header, token, BlurHash or height. A plain surface2 shows under it until the image arrives (the owner's blurred
// preview is its own task; decisions-owner-inbox-2026-11-23b.md §3). A failed image calls the slot's onFailed, so the
// card shows its title. With no session nothing is requested and the slot fails at once.
import type { OctaveArtworkViewProps } from "@octave/artwork";
import { memo, useCallback, useEffect, useRef, type ComponentProps, type ComponentType } from "react";
import { StyleSheet, View } from "react-native";
import type { ArtworkComponent } from "../design/rows/artwork";
import { colors } from "../design/tokens";

export type NativeArtworkOptions = {
  /** The native view: loadArtworkView() in the app, a fake in tests. */
  view: ComponentType<OctaveArtworkViewProps>;
  /** The signed-in session's opaque id, or undefined when signed out. */
  session: () => string | undefined;
};

type StateEvent = Parameters<NonNullable<OctaveArtworkViewProps["onArtworkState"]>>[0];

export function createNativeArtwork({ view: NativeView, session }: NativeArtworkOptions): ArtworkComponent {
  function NativeArtwork({ image, width, onFailed, testID }: ComponentProps<ArtworkComponent>) {
    const id = session();
    const failed = useRef(onFailed);
    failed.current = onFailed;

    useEffect(() => {
      if (id === undefined) failed.current();
    }, [id]);

    const onArtworkState = useCallback((event: StateEvent) => {
      if (event.nativeEvent.state === "failed") failed.current();
    }, []);

    return (
      <View testID={testID} style={styles.placeholder}>
        {id === undefined ? null : (
          <NativeView
            session={id}
            itemId={image.itemId}
            imageType={image.type}
            tag={image.tag}
            width={Math.round(width)}
            onArtworkState={onArtworkState}
            style={StyleSheet.absoluteFill}
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
