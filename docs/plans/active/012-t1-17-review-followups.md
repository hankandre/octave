# 012: T1-17 review follow-ups

## Goal / Done when

Record the T1-17 fresh-context review's low findings so the owner and later tasks see them (T1-17).

- [x] Review found nothing needing a fix
- [x] Lows below logged as follow-ups, not fixed
- [ ] T1-17 set to done once item 4 (gate ci) is shown on a real pull request

## Context and domains touched

Process (`.github/workflows/ci.yml` and `scripts/ci-*`). The spec at `docs/specs/T1-17.md` holds the rules.

## Dependencies

None added.

## Milestones

1. **Log the review's lows.** Validation: `mise exec -- pnpm check`.

## Progress

- [x] 1

## Decision log

- 2026-11-22: No review finding needs a fix; the five lows are logged, not fixed.
- 2026-11-22: T1-17 stays in_progress. Item 4 needs CI and a merged docs/tasks-only pull request (Ship phase and after).

## Surprises & discoveries

Follow-ups (low, not fixed in T1-17):

- .github/workflows/ci.yml:93 (same at 159 and 302); scripts/ci-device-jobs.mjs:24-35: the skip is computed against the pull request's base at run time, but the result attaches to the head SHA. A PR that targets a task branch and changes only docs/ relative to it skips tv and tripwire; if its base is then edited to main, no new run starts (`edited` is not a default pull_request type; unverified) and the stale skipped results satisfy ruleset 26769544, so app code could land untested by the device jobs. Fix: give skip only when github.base_ref == 'main' (pass it to the decide step and require it in deviceJobsDecision), or add `edited` to the pull_request types.
- .github/workflows/ci.yml:93,159,302: `needs: changes` opens a window where tv and tripwire wait. A manual cancel in that window makes `!cancelled()` false and both skip; a skipped job counts as success for a required check (F11). If `checks` already finished green because `changes` sat in the runner queue, no device test runs. Unlikely. Whether GitHub reports skipped-on-cancel jobs as passing required checks is unverified.
- scripts/ci-emulator-retry.mjs:40-48: the retry path runs `pkill -KILL -f qemu-system` and `adb kill-server`, then reboots the same AVD. A SIGKILLed emulator can leave *.lock files, so the retry could refuse to start. Depends on whether the pinned action recreates the AVD with --force-avd-creation (default); unverified (spec F4). Cost is a wasted retry.
- scripts/ci-device-jobs.test.ts:141 (commit cb656cdb): a frozen test gained one setup line (mkdirSync docs/ before git mv), with the `Frozen-Test-Change` trailer; `pnpm lint:flow` passes; no assertion weakened. No Product Owner ruling for T1-17 is recorded in tasks/product-owner-log.md or docs/specs/decisions-*.md. WORKFLOW.md:81 requires the PR's Frozen tests section to name this change; Ship must include it.
- tasks/prd.json:597-603 (acceptance item 6): the PR call-out (a 'CI change' section) cannot be checked until the PR exists. Ship must include it, stating that tv and tripwire, both required checks, can now pass by being skipped.
