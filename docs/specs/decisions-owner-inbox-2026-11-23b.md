# Owner decisions, 2026-11-23 (second set)

The owner's answers on the decisions page on 2026-11-23, recorded by the coordinator. Each names the task it settles and is the owner approval for the wording, look or behaviour it describes. Placement and order are the Product Owner's.

## 1. A page that does not exist (T3-09)

A new row in `DESIGN.md` §10 for an unknown route:

| Title | Message | Action |
|---|---|---|
| This page isn't available | It may have moved, or this account can't see it. | Go home |

The "item gone" row is not reused, because the path may never have named an item.

## 2. Holding select or pressing Menu on a card (T7-03, T5-05)

- On a **Continue watching** card, holding select or pressing Menu or Info opens the short menu (Mark as watched, Go to series for episodes, Details; Remove when Jellyscale #233 ships), as decided for T5-05.
- On **every other card** that plays, holding select or pressing Menu or Info opens the title's page, as T7-03 says today.

T7-03's acceptance is edited to exclude Continue watching cards, with this file as the approval.

## 3. What a card shows while its artwork loads (T3-11)

The owner chose **a blurred preview of the picture** (the title's BlurHash, decoded natively).

- The blurred preview needs a sixth prop on the native image view, which decision 0005 and T3-11 item 1 ("only" five props) do not allow today. It is an architecture change: a decision 0005 amendment and native work, as a task of its own (backlog line of the same date).
- So the slice is not held up, T3-11 ships now with the plain card surface (`surface2`, without the title) as a stand-in, and the blurred preview replaces it when that task lands. The plain surface is provisional, not the owner's choice.
