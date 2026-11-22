# Owner decisions given in chat, 2026-11-22

The owner's answers of 2026-11-22, given in chat after the decision inbox of the same day (`docs/specs/decisions-owner-inbox-2026-11-22.md`). The coordinator relayed them to a directed Product Owner pass, which wrote them down here. This file holds the owner's decisions and what is still pending with the owner. Where each one was placed, and everything the pass derived or could not verify, are the Product Owner's and are in `tasks/product-owner-log.md`.

## 1. Continue watching: 90 days and at most 20 (T5-07, T5-02)

The window is 90 days and the row shows at most 20 titles. Where T5-02's acceptance says 16, the owner's 20 wins. T5-07 carries the change.

## 2. The icon set: Tabler (T3-34)

The owner chose Tabler icons, as in the inbox answer 2.

**The stroke weight (owner, 2026-11-22, from the decision inbox):** light. The icons use Tabler's weight-300 font. T3-34 reads the weight from here.

## 3. The Signal loader's motion (T3-35)

The owner updated the motion of the Signal loader. It replaces "on each pulse one more letter lights up" in the inbox answer 7.

- The brass bar is a beacon.
- Every pulse, about 1.5 seconds apart, sends a wave across the whole name.
- Each letter lights as the wave reaches it, o first and e last, and then fades back.
- The next pulse repeats the sweep.
- When the film is ready the whole name lights and holds.
- Where space is tight the bars-only version is used: the pulse and the rings.
- With reduced motion the still mark is shown with "Loading…".

The reference is the coordinator's logo page, round 7.

**The brass colour (owner, 2026-11-22, from the decision inbox):** `#E8C48A`, and it becomes a design token. T3-35 reads the colour from here.

The owner's inbox answer "when spelled, hold, dim and spell again" was given for the earlier version, where each pulse lit one more letter. The owner then changed the motion to the wave above, so that answer does not apply. The wave stands.

## 4. The menu on a Continue watching card (T5-05)

Holding select on a Continue watching card opens a menu that holds:

- Remove from Continue watching
- Mark as watched
- Go to series (for episodes)
- Details

This is the owner step of T5-05: what else the menu holds besides Remove, and its labels.

## 5. The Settings sections (T9-08)

The owner accepted the proposal of T9-08: the sections of `DESIGN.md` 7.18, in that list's order, and no Advanced section.

## 6. The pipeline options of T1-20's report (T1-22, T1-23, T1-24)

From the six options of `docs/research/pipeline-cost.md`, the owner took options 1, 2 and 6:

- **Option 1 (T1-22).** Run the mechanical gates (sync, red, frozen, green, fixtures down) as commands inside the coordinator or the next agent, not one agent each.
- **Option 2 (T1-23).** Hand the CI wait in Ship to a polling loop, or to the cheaper `scout` model.
- **Option 6 (T1-24).** Run `pnpm check` and the frozen gate locally before Ship.

Options 3, 4 and 5 are declined: the separate spec check stays for small routine tasks, the spec of a small routine task keeps its model, and Tests is not folded into Implement.
