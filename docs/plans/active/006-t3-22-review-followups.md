# 006: T3-22 review follow-ups

## Goal / Done when

Record the T3-22 fresh-context review's medium finding and its low findings so the owner and later tasks see them (T3-22).

- [ ] Medium, CI gate: the `tv` job of `ci.yml` is green on the PR head commit, with its `pnpm tv:apk:check` step (item 1's proof that the four permissions and three queries are gone from the release APK, spec check note 4) and its `pnpm tv:smoke` step (item 4's gate) passing in that same run; the task evidence names that PR and its head commit, not 429d70c4
- [x] Lows below logged as follow-ups, not fixed
- [ ] T3-22 set to done with evidence naming the PR
- [x] `pnpm check` is green and `node scripts/check-red.mjs T3-22 --expect green` holds items 1, 2, 3 and 5

## Context and domains touched

Security & Redaction (the release manifest and backup rules) and Process (`scripts/`). The spec at `docs/specs/T3-22.md` holds the rules, the milestones and the Implementation record.

## Dependencies

None added.

## Milestones

1. **Review record.** The medium finding has no code fix: it is met only by the `tv` job on the PR head, which the Ship phase records. The lows are logged here. Validation: `mise exec -- pnpm check`, `node scripts/check-red.mjs T3-22 --expect green`. Model: opus.
2. **Ship.** Rebase onto origin/main (both sides touch `tasks/prd.json`), open the PR, record the `tv` job's `pnpm tv:apk:check` and `pnpm tv:smoke` steps green on the head commit, set T3-22 to done with evidence naming the PR. Model: sonnet.

## Progress

- [x] 1
- [ ] 2

## Decision log

- 2026-11-21: T3-22 stays `in_progress` until the `tv` job is green on the PR head; local `tv:apk:check` and `tv:smoke` runs do not set `passes` (review medium finding).

## Surprises & discoveries

Follow-ups (low, not fixed in T3-22):

- scripts/tv-apk-manifest.mjs:44 and :81 (`parseAttribute`, `parseXmlTree`): attributes are stored by local name only, with the namespace dropped, and a later attribute overwrites an earlier one. The reviewer reproduced it on the after-fixture: an `E: uses-permission` with `android:name="android.permission.CAMERA"` followed by `A: http://example.com/x:name="android.permission.INTERNET"` makes `judgeManifestSurface` return []. The same overwrite on `<application>` turns `android:allowBackup=true` followed by `x:allowBackup="false"` into allowBackup=false, so `judgeBackup` passes. A library manifest carrying a same-named attribute in another or no namespace could let CAMERA or `allowBackup=true` reach the release APK unflagged; whether the manifest merger and aapt2 keep such an attribute in the APK is unverified. Fix: read only the android-namespace attribute (or key by the full name), and treat a duplicate local name as an error.
- docs/security.md:142 (§6 opening, "none of its data leaves the device through Android backup or a device-to-device transfer") and :167 ("No preference is backed up, so no credential, LAN confirmation, preference or install id is in a backup or a transfer"): both state on-device behaviour as fact with no Tested/Planned marker, though the file's opening requires one on every claim and the next bullet marks the same behaviour Planned (T4-05, T4-09). If `path="."` does not exclude a whole domain on some OEM build, security.md still says outright that no data leaves the device. Fix: mark both sentences Planned (T4-05, T4-09), or reword them as declarations.
- scripts/tv-manifest-trim.test.ts:155-245 (frozen, item 1): the frozen tests run `trimManifest` on a hand-built template-shaped object; they never check that `expo-file-system`'s two queries or the storage permissions are gone from the merged release manifest, and the query-marker form is unfrozen. The only proof of real removal is the `tv` job's `pnpm tv:apk:check` (the medium item above). Acceptable per the spec, but item 1 is not met until that CI run exists.
- scripts/tv-apk-manifest.test.ts:284-304 (frozen, item 2) and scripts/tv-apk-manifest.mjs:292-295: the command-line tests cover only failure exits (a removed entry present, no APK). No test runs a passing CLI path, so the success summary and `tree.children` on a parsed manifest run only in the local and CI `tv:apk:check`. A later change that makes `main()` throw after `checkManifest` returns [] (for example, `manifestText` not captured because the dump arguments change) would exit non-zero on a good APK with nothing below CI catching it. Fix: a new (unfrozen) test that runs the CLI against the recorded after-fixtures through a fake `aapt2` and expects exit 0 and the summary line.
- scripts/tv-apk-manifest.test.ts:334-458 (frozen, item 3): the frozen `judgeBackup` cases use synthetic facts, and the passing exclude `path` comes from the plugin's own `DATA_EXTRACTION_RULES_XML`, so a wrong path spelling in the plugin would also pass. "A test reads the setting from the release build" is met only by the unfrozen `scripts/tv-manifest-trim-extra.test.ts` (recorded dumps) and by CI's `tv:apk:check`, and the extra test can be edited freely. Fix: pin the expected domains and `path="."` in a test that does not import the plugin's constant.
- scripts/tv-apk-manifest.test.ts:471-481 (frozen, item 5): the test checks only that the listed strings appear in §6. It would pass a §6 that names the entries but drops the removed-entry reasons, or marks on-device behaviour as Tested. No test enforces the Tested/Planned honesty of spec check note 3 (see the security.md item above). Fix: a new test that every bullet and table row in §6 carries a Tested or Planned marker, and that the backup-or-transfer behaviour is marked Planned.

## Validation evidence

Milestone 1, 2026-11-21: see the spec's Implementation record, "Review record".

## Outcome & retrospective

Open.
