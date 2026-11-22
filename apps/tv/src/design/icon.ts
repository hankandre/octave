// The icon slot. No icon set is chosen yet, so a control takes a component that draws itself at the size and colour
// the control gives it. A later task adopts the owner's set behind this type.
import type { ComponentType } from "react";

export type IconComponent = ComponentType<{ size: number; color: string }>;
