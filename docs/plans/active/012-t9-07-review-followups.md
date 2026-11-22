# 012: T9-07 review follow-ups

## Goal / Done when

Fix the T9-07 review's high and medium findings and log its lows (T9-07).

- [x] User info with an @ in the user name hides the password
- [x] User info is hidden before paths, so a password holding a path start does not stop it
- [x] Lows below logged as follow-ups, not fixed
- [x] T9-07 set to done with evidence naming the commit

## Context and domains touched

`packages/core/src/safe-reason.ts`. The spec at `docs/specs/T9-07.md` holds the rules.

## Dependencies

None added.

## Milestones

1. **Fix the two leaks and log the lows.** Validation: `mise exec -- pnpm check`.

## Progress

- [x] 1

## Decision log

- 2026-11-22: USER_INFO now allows @ in the user part and runs before hidePaths. Tests in `safe-reason-userinfo.test.ts` (new file; frozen tests untouched).

## Surprises & discoveries

Follow-ups (low, not fixed in T9-07):

- safe-reason.ts USER_INFO has two length limits (user 1 to 64, 0 to 256 before the @). Past either, the text shows as-is: 70 `x` + `:pass@nas`, or `user:` + 300 `p` + `@nas`. R6 sets no limit; a long token-like password is plausible.
- safe-reason.ts NAME_LABEL (`[a-z0-9-]`): a host name with an underscore is never hidden (`my_nas.local`, `my_nas:8096`). NetBIOS-style and some mDNS names use them. Not in the backlog lines or docs/security.md residuals.
- safe-reason.ts isPathStop stops at `'` and `)`: `/media/Ocean's Eleven (2001).mkv` and `/media/Inception (2010)/Inception (2010).mkv` leave title and extension fragments showing; a double space also ends a path (fails closed as `[address]`). R8 follows the spec, but item 3 says no file name fragment shows, and "Name (Year)" is Jellyfin's layout. Not in the backlog leftovers.
- tasks/backlog.jsonl:237-240: Risks names five leftovers "one line each", but the label-word host and the code-namespace host share one line; the "R2 list narrows today's hiding" sentence sits in the label-word line (238), not the single-label line (237). The gate is met on a reasonable reading.
- safe-reason-gaps.test.ts (frozen) item 2 uses only a plain `pass` password and a user with no @, so it could not catch the two leaks fixed here; covered by `safe-reason-userinfo.test.ts`.
