// The rail's glyphs (T3-34, docs/specs/decisions-owner-chat-2026-11-24.md §2). A change is one line here and its entry in
// the glyph map.
import { iconOf } from "../design/icon";
import type { RailIconName } from "./rail-entries";
import type { IconComponent } from "../design/icon";

export const railIcons: Record<RailIconName, IconComponent> = {
  search: iconOf("search"),
  home: iconOf("home"),
  movies: iconOf("movie"),
  tvshows: iconOf("device-tv"),
  boxsets: iconOf("stack-2"),
  settings: iconOf("settings"),
  account: iconOf("user"),
};
