# 012: T3-28 review follow-ups

## Goal / Done when

Record the T3-28 fresh-context review's low findings so the owner, the Product Owner and later tasks see them, and close T3-28 at Ship (T3-28). The milestones, facts and Implementation record of the task itself are in `docs/specs/T3-28.md`.

- [x] The review found no finding that needs a fix
- [x] Lows below logged as follow-ups, not fixed
- [x] T3-28 set to done with evidence naming the PR (Ship phase)

## Context and domains touched

Security & Redaction (the native inspector check, `scripts/tv-elf.mjs` and `scripts/tv-apk-native-inspector.mjs`, a step of `pnpm tv:apk:check`) and its claims in `docs/security.md` (the inspector row at line 77 and "What the dex check cannot see" at line 100).

## Dependencies

None added.

## Milestones

1. **Log the review's lows.** Model: opus.
2. **Ship.** Open the PR with a security heading that calls out the `docs/security.md` change (the inspector row and "What the dex check cannot see") and the new fifth step of `pnpm tv:apk:check` (`tv-apk-native-inspector`), and lists the untested gates: a real TV, the Shield, arm64 execution, other Android versions, Jellyfin, Jellyscale, a debugOptimized APK, and the three source reads. Record the `tv` job's `pnpm tv:apk:check` step (with the native inspector line) and the `checks` job green on the PR head, then set T3-28 to done with evidence naming the PR. Model: sonnet.

## Progress

- [x] 1
- [x] 2

## Decision log

- 2026-11-22: T3-28 stays `in_progress` (passes=false) until the `tv` and `checks` jobs are green on the PR head: item 5 is a CI gate and item 6 needs the PR to call out the change (the same rule as T3-22 and T3-23 in plan 006).
- 2026-11-22: The seven lows are logged, not fixed, as the workflow directed.

## Surprises & discoveries

Follow-ups (low, not fixed in T3-28), grouped by what would close them.

Ship checklist (no code):

- task/T3-28 (acceptance item 6): no PR exists yet, so "the PR calls out the change" cannot be checked at review. If Ship opens the PR without naming the `docs/security.md` change and the new `pnpm tv:apk:check` step under its security heading, the AGENTS.md rule "Call out changes to ... docs/security.md ... or CI in the PR" is broken. Fix: Ship writes both call-outs (milestone 2 above); the owner gate checks them.
- tasks/prd.json:1056 (T3-28 evidence): it names commit b7647bfb and "4 milestone commits e9478cfc..b7647bfb", but edbfbfc5 edits `docs/security.md` after b7647bfb, so the evidence does not cover the final document text. Fix: at Ship, name the PR in the evidence. A tip sha would go stale with the commit that records it.

Docs wording (one docs commit; `scripts/security-doc-t3-28.test.ts` does not pin either phrase, checked by grep for `debugOptimized` and `no other native code`, no match):

- docs/security.md:77: "Shown failing on L2 and L3 on a debug APK and on the published debugOptimized library" overstates the debugOptimized run. The real reader (`readElf`, `hasBytes`) never read that library; only `judgeNativeInspector` ran, on the llvm-readelf cut `scripts/fixtures/tv/native/debug-optimized-aar.json`, and the evidence lists a debugOptimized APK as untested. Fix: say the judge fails on a cut of the debugOptimized library and the command was run on the debug APK.
- docs/security.md:100: "reads the one relocation that would wire its C++ caller ... and reads no other native code" is inexact: the check also searches every library's raw bytes for the L3 string. A later editor could read the sentence as saying L3 does not exist and drop it. Fix: add "and one debugger-only string".

Reader hardening (new test files; a Product Owner call on the first item because the spec asks for the current behaviour):

- scripts/tv-elf.mjs:133: `readElf` skips a REL or RELA section whose `sh_link` is not the `.dynsym` index and adds no `problems` entry, as the spec asks. L1's anchor (a relocation naming LOADER somewhere) only partly covers it: a future linker that links `.rela.plt` to another index while LOADER's relocation stays in `.rela.dyn` makes L2 pass blind. Fix: record a problem for such a section (L0 then fails closed), or require the LOADER anchor in the same section kind L2 reads. The frozen `scripts/tv-elf.test.ts` sample links every relocation section to `.dynsym`, so the first fix does not contradict it (unverified against the real libraries until `pnpm tv:apk:check` runs on it).
- scripts/tv-elf.test.ts:45 (frozen): the test builds only SHT_RELA (24-byte) sections, so the SHT_REL 16-byte path in `readRelocations` (`minimum = 16`) never runs. Limited impact: only ELF64 ABIs ship and they use RELA, and an ELF32 library fails L0. Fix: a REL case in a new test file, or treat an SHT_REL section as a `problems` entry and drop the untested branch.
- scripts/tv-apk-native-inspector.mjs:62: L0's packed-relocation rule also covers a library that only imports the dispatcher (an undefined symbol), but the frozen tests exercise only the inspector library (packed, fails) and a library that names no dispatcher (packed, passes); `scripts/tv-apk-native-inspector.test.ts:219` is the closest. A refactor that narrows the rule to defined symbols would pass. L2's import rule still fires, so impact is low. Fix: a new test file that passes `judgeNativeInspector` a library with an undefined dispatcher symbol and `packedRelocations: true` and expects L0.

## Validation evidence

Milestone 1, 2026-11-22: see the task evidence and the commit that adds this plan.

Not run: a real TV, the Shield, arm64 execution, other Android versions, Jellyfin, Jellyscale, a debugOptimized APK, the three source reads, and the `tv` and `checks` CI jobs (Ship phase).

## Outcome & retrospective

Open.
