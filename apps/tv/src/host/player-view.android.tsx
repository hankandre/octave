// The one place the app loads the player module's native view (T8-01). The view hosts the video and takes no prop:
// React only places it, and the surface reaches an engine natively. `expo` exports expo-modules-core's
// requireNativeViewManager under the name requireNativeView; the app has no direct expo-modules-core dependency.
import { requireNativeView as requireNativeViewManager } from "expo";
import type { ComponentType } from "react";
import type { ViewProps } from "react-native";

export type PlayerViewProps = Pick<ViewProps, "style">;

export function loadPlayerView(): ComponentType<PlayerViewProps> {
  return requireNativeViewManager<PlayerViewProps>("OctavePlayer");
}
