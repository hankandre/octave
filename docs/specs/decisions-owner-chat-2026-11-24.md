# Owner decisions given on the decisions page, 2026-11-24

## 1. What Home's hero shows as the title (T5-03)

The owner chose "Text title now, Logo later".

- The hero's title is set as text in the hero type style (`typeHero`).
- A later task draws the title's Logo image, once the native artwork slot can show nothing while an image loads or report that it loaded.
- Until then DESIGN.md §4 and §12 decision 3 (the Logo image is the hero's title) is not met on Home, by the owner's choice.

## 2. The side rail's icons (T3-34)

The owner chose the recommended Tabler glyphs, one per rail entry:

- Search: `search`
- Home: `home`
- Movies: `movie`
- Shows: `device-tv`
- Collections: `stack-2`
- Settings: `settings`
- No account: `user`

A change later is a one-line edit in `apps/tv/src/shell/rail-icons.ts` and its entry in the glyph map.
