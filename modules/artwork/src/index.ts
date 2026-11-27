// The artwork module's JavaScript surface (T3-11, T3-39): one native view whose only props are the opaque session id,
// the item id, the image type, the tag, the drawn width in canvas px and the image's BlurHash string, and whose only
// event is onArtworkState with a fixed word. No URL, header or token prop. The app's slot draws the view twice: a
// preview view that gets only blurHash, and the picture view that gets the other five and the event handler; so every
// prop is optional here. Types only: the one place that loads the view is the app's
// apps/tv/src/host/artwork-view.android.tsx. The package depends on nothing, so `style` is typed loosely here and the
// app passes a React Native style.

export type ArtworkImageType = "Primary" | "Backdrop" | "Thumb" | "Logo";

export interface ArtworkStateEvent {
  readonly state: "loaded" | "failed";
}

export interface OctaveArtworkViewProps {
  readonly session?: string;
  readonly itemId?: string;
  readonly imageType?: ArtworkImageType;
  readonly tag?: string;
  // No prop may be a name React Native's layout reads (T3-42): `width` there sized the view in dp.
  readonly drawnWidth?: number;
  readonly blurHash?: string;
  readonly onArtworkState?: (event: { nativeEvent: ArtworkStateEvent }) => void;
  readonly style?: unknown;
}
