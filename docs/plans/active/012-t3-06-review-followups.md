# 012: T3-06 review follow-ups

## Goal / Done when

Fix the T3-06 fresh-context review's two mediums, log its lows for the owner, the Product Owner and later tasks, and close T3-06 (T3-06). The task's own milestones and decisions are in `docs/specs/T3-06.md`.

- [x] Medium fixed: Toast keeps `onDismiss` in a ref, so an inline callback no longer restarts the 5 s timer (`apps/tv/src/design/controls/review-fixes.test.tsx`)
- [x] Medium fixed: TextField holds its ring and lift while its native input has focus, through a `holdFocus` prop on `FocusFrame` (same test file)
- [x] Lows below logged as follow-ups, not fixed
- [x] T3-06 set to done with evidence naming the commit

## Context and domains touched

App Shell & Presentation: `apps/tv/src/design/` (`focus-frame.tsx`, `controls/toast.tsx`, `controls/text-field.tsx`).

## Dependencies

None added.

## Milestones

1. **Fix the mediums.** Model: sonnet.
2. **Log the lows.** Model: sonnet.
3. **Close.** Model: sonnet.

## Progress

- [x] 1
- [x] 2
- [x] 3

## Decision log

- 2026-11-22: Toast fix is a ref, not a `useCallback` requirement on callers: the control owns the guarantee. The new test fails on the old code (1 failed) and passes on the new.
- 2026-11-22: TextField fix is a `holdFocus` prop on `FocusFrame` set from the input's own focus and blur, so the ring does not depend on the frame's `onBlur`. Jest has no focus engine, so the test fires the events by hand; the real focus order on Android TV is unverified (see follow-up 1).
- 2026-11-22: The lows are logged, not fixed, as the workflow directed.

## Surprises & discoveries

Follow-ups (low, not fixed in T3-06):

1. Device check still owed (medium fix above): that `input.current?.focus()` really leaves the frame ring on screen while typing on the Android TV emulator is unverified; the test covers the state logic only.
2. apps/tv/src/design/controls/focus-motion.test.tsx:1-4 and apps/tv/src/design/focus-frame.tsx:62-75 (frozen, item 4): the test checks only that a scale transform exists on the `-scale` element, not that the lift reaches `motion.lift` (1.08) or that press goes to 0.98. A wrong lift value, or a lift that never completes, would pass. Fix in a new test file that reads the animated value.
3. apps/tv/src/design/controls/dialog.tsx:34-48: focus goes to `initialFocus` or, by default, the last action. If that action is `disabled`, or `initialFocus` names an id that does not exist, no button has `hasTVPreferredFocus` and the trapped dialog may leave no control focused. Fall back to the first enabled action.
4. apps/tv/src/design/focus-frame.tsx:92-107: no test covers `disabled` toggling while the control holds focus or is pressed. `onFocus` returns early when disabled but `onBlur` does not, so a control disabled then re-enabled while still natively focused shows no ring until focus leaves and returns. The effect is small.
5. pnpm-workspace.yaml:7: `'@parcel/watcher': false` came in with commit b7d2db2c (the Jest stack). `false` denies that package's install script, so it tightens `allowBuilds` rather than loosening it; the package is a transitive dependency in `pnpm-lock.yaml`. Whether the owner wants it recorded this way is for the Product Owner to confirm.
6. tasks/prd.json (T3-06 evidence) said "Provisional: PO rulings (Jest setup, container-control reading) open". The spec's decisions are recorded as settled in `docs/specs/T3-06.md` (the repeat-guard ruling is in commit becdfe43); the evidence is replaced at close.

## Validation evidence

See the T3-06 evidence in `tasks/prd.json` and the commit named there.

## Outcome & retrospective

T3-06 closed.
