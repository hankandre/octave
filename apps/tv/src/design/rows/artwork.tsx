// The artwork slot (T3-08). T3-11's native image view fills it. The component takes an `ImageRef` and the drawn size in
// canvas px, never a URL, header or token, and reports a failed load through `onFailed`. The same provider carries the
// played glyph (with none, the card draws Tabler's check), so a screen sets up one provider. With no provider the slot is empty and a card shows its title.
import { createContext, useContext, useMemo, type ComponentType, type ReactNode } from "react";
import type { ImageRef } from "@octave/core/src/domain/catalog";
import type { IconComponent } from "../icon";

export type ArtworkComponent = ComponentType<{ image: ImageRef; width: number; height: number; onFailed: () => void; testID?: string }>;

export type ArtworkSlots = { component?: ArtworkComponent; playedIcon?: IconComponent };

const NO_SLOTS: ArtworkSlots = {};
const ArtworkContext = createContext<ArtworkSlots>(NO_SLOTS);

export function ArtworkProvider({ component, playedIcon, children }: ArtworkSlots & { children: ReactNode }) {
  const value = useMemo(() => ({ component, playedIcon }), [component, playedIcon]);
  return <ArtworkContext.Provider value={value}>{children}</ArtworkContext.Provider>;
}

export function useArtwork(): ArtworkSlots {
  return useContext(ArtworkContext);
}
