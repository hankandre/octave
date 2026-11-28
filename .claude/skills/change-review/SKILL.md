---
name: change-review
description: Review an Octave diff in a fresh context against its spec, plan and rules. Use for every change before the owner gate; never on a change you implemented.
---

# Change review

## Setup

- Run in a fresh context.
- Never review a change you implemented.
- Run one review round; small findings are fixed in the same pull request.
- Use `guardian` (Opus) when the diff touches tokens, credentials, the network client, sign-in, links, redaction or `SECURITY.md`.
- Use `reviewer` (Sonnet) otherwise.
- Read the spec, the plan or issue first.
- Get the diff with `git diff <base>...HEAD`.

## Review

- Walk every item in `references/checklist.md`.
- Look for correctness bugs and missed edge cases.
- Look for stubs, skipped tests, weakened assertions, and justified workarounds.
- Check that tests cover the changed behaviour.

## Report

- Give each finding a `file:line`, a concrete failure scenario, and a severity.
- Rank findings most severe first.
- Skip style.
- Never propose a new abstraction unless a finding requires one.
- Say "no findings" when there are none.
