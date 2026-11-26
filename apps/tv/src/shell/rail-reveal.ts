// Where the rail's scrolling group moves to keep a focused entry and its ring in view (T3-40). Android's own scroll to a
// focused child leaves it flush with the edge, which cuts its ring.

export type Reveal = {
  /** Where the list is scrolled to now. */
  offset: number;
  /** The entry's top, from the top of the list's content. */
  top: number;
  height: number;
  /** The space to keep above and below the entry. */
  room: number;
  viewport: number;
  content: number;
};

/** The offset nearest `offset` that shows the entry with its room, within what the list can scroll. */
export function revealOffset({ offset, top, height, room, viewport, content }: Reveal): number {
  const lowest = top + height + room - viewport;
  const highest = top - room;
  const wanted = Math.min(Math.max(offset, lowest), highest);
  const end = Math.max(0, content - viewport);
  return Math.min(Math.max(wanted, 0), end);
}
