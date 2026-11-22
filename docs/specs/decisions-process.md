# Process decisions, 2026-11-22

The owner's decisions of 2026-11-22 on review follow-ups, what is built next, and how the task workflow runs. The coordinator relayed them to the Product Owner pass of the same day, which wrote them down here. This file holds the owner's decisions only; the placement, the task order and each gate call are the Product Owner's and are in `tasks/product-owner-log.md`.

## Review follow-ups (T3-17, T3-12, T3-13, T3-14, T3-31, T1-18)

Decided by the owner on 2026-11-22, relayed by the coordinator. It relaxes the owner's rule of 2026-11-21 that security lows are fixed promptly.

1. A reviewer's small findings are fixed in the same pull request, not logged.
2. The remaining findings that gate nothing go to one hardening task per phase, instead of one task each.
3. Only a finding that opens a path into the self-hoster's home network, or leaks local information (a LAN address, a serial, a hostname, credentials), gates an install on a real TV.

The rule is written into `WORKFLOW.md`, and the real-TV gates in place are judged again against point 3.

## A thin slice comes next (T4-02, T4-01)

Decided by the owner on 2026-11-22, relayed by the coordinator.

The shortest path to a working vertical slice on the emulator against the fixture servers comes next: sign in (typing the address by hand is fine; discovery, T4-01, may follow), browse Home's rows, and play one file directly. Hardening continues in parallel lanes.

## Lanes that run themselves (T1-19)

Decided by the owner on 2026-11-22, relayed by the coordinator.

Each task records a lane (for example native-session, apk-checks, tv-scripts, ui, core, player, workflow). A lane runner pulls its lane's next ready task when one finishes, without the coordinator starting it again. Where `AGENTS.md` requires serial work, one native or on-device lane runs at a time.

## Measure before trimming the pipeline (T1-20)

Decided by the owner on 2026-11-22, relayed by the coordinator.

Sum the wall time and the tokens of each stage for each merged task from the workflow's journals, then propose a lighter pipeline for small low-risk tasks for the owner to decide. No stage is cut now.
