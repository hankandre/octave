// The sibling a tvOS build loads (decision 0003): the artwork view is Android-only until a Swift loader mirrors the
// Kotlin one. The message is fixed text.
import type { OctaveArtworkViewProps } from "@octave/artwork";
import type { ComponentType } from "react";

export function loadArtworkView(): ComponentType<OctaveArtworkViewProps> {
  throw new Error("The artwork view is not available on this platform.");
}
