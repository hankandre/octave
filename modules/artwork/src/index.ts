// The artwork module's JavaScript surface (T3-11): one native view whose only props are the opaque session id, the
// item id, the image type, the tag and the drawn width in canvas px, and whose only event is onArtworkState with a
// fixed word. No URL, header or token prop. Types only: the one place that loads the view is the app's
// apps/tv/src/host/artwork-view.android.tsx. The package depends on nothing, so `style` is typed loosely here and the
// app passes a React Native style.

export type ArtworkImageType = "Primary" | "Backdrop" | "Thumb" | "Logo";

export interface ArtworkStateEvent {
  readonly state: "loaded" | "failed";
}

export interface OctaveArtworkViewProps {
  readonly session: string;
  readonly itemId: string;
  readonly imageType: ArtworkImageType;
  readonly tag: string;
  readonly width: number;
  readonly onArtworkState?: (event: { nativeEvent: ArtworkStateEvent }) => void;
  readonly style?: unknown;
}
