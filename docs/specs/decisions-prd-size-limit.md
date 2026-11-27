# Owner decision: the size limit of tasks/prd.json, 2026-11-22

The owner's answer of 2026-11-22, relayed by the coordinator to a directed Product Owner change of the same day, which wrote it down here. This file holds the owner's decision only. What was edited to carry it out, and what was checked, is in `tasks/product-owner-log.md`.

## The limit (T1-13, T1-21)

The owner chose: "Raise to 350 KB now".

- The size limit of `tasks/prd.json` that `pnpm check` enforces goes from 250,000 bytes to 350,000 bytes. This changes acceptance item 5 of T1-13 ("over 250 KB" becomes "over 350 KB").
- T1-21 (move finished phases out of `tasks/prd.json`) still runs next and brings the file back down. Its acceptance item on the limit now names the 350,000-byte limit as the one that stays unchanged.

What the owner was told when asked, as relayed: the file was at 248,185 of 250,000 bytes, and a few more finished tasks would have turned every branch red.

## Amendment, 2026-11-26: 450 KB (T17-24, T1-13, T1-21)

The owner was asked: "The task list has a 350 KB limit, which you set on Nov 22. With the web tasks it's at 346 KB, and TV progress updates would push it over within days. After that, every pull request fails. What should I do?" The options were "Raise it to 450 KB (Recommended)" and "Keep 350 KB, archive first". The owner chose: "Raise it to 450 KB (Recommended)".

- The limit goes from 350,000 bytes to 450,000 bytes. This changes acceptance item 5 of T1-13 ("over 350 KB" becomes "over 450 KB") and T1-21's item 3, which now names the 450,000-byte limit as the one that stays unchanged.
- T1-21 still moves finished phases out of `tasks/prd.json`; it is a later task, not a gate.
- The full record of the question is in `docs/specs/decisions-owner-web-2026-11-26.md` §5.
