// The sibling a tvOS build loads (decision 0003): the player view is Android-only until a Swift engine has its own
// layer host. The message is fixed text.
import type { ComponentType } from "react";
import type { ViewProps } from "react-native";

export type PlayerViewProps = Pick<ViewProps, "style">;

export function loadPlayerView(): ComponentType<PlayerViewProps> {
  throw new Error("The player view is not available on this platform.");
}
