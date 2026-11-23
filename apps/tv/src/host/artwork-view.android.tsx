// The one place the app loads the artwork module's native view (T3-11). The view takes only the session id, the item
// id, the image type, the tag and the drawn width, and reports onArtworkState with a fixed word. `expo` exports
// expo-modules-core's requireNativeViewManager under the name requireNativeView; the app has no direct
// expo-modules-core dependency.
import type { OctaveArtworkViewProps } from "@octave/artwork";
import { requireNativeView as requireNativeViewManager } from "expo";
import type { ComponentType } from "react";

export function loadArtworkView(): ComponentType<OctaveArtworkViewProps> {
  return requireNativeViewManager<OctaveArtworkViewProps>("OctaveArtwork");
}
