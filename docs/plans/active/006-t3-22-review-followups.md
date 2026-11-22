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

- 2026-11-22: the T3-23 review's item 3 medium is met by building the probe again, not by marking the record unverified; the hand-abridged excerpt is removed from the spec and the re-run is pasted with its three cuts stated.
- 2026-11-22: `parseAttribute` refuses a quoted value holding a quote instead of reading escapes, because aapt2 prints values unescaped (unverified beyond the 176 Raw lines of the recorded dumps and the built APK, which all read). A real attribute value with a quote would fail the check closed.
- 2026-11-21: T3-23 stays `in_progress` (passes=false) until the `tv` job's `pnpm tv:apk:check` step and the `checks` job are green on the PR head (T3-23 review medium finding: no PR or origin branch exists yet).
- 2026-11-21: T3-22 stays `in_progress` until the `tv` job is green on the PR head; local `tv:apk:check` and `tv:smoke` runs do not set `passes` (review medium finding).

## Surprises & discoveries

Follow-ups (low, not fixed in T3-22):

- scripts/tv-apk-manifest.mjs:44 and :81 (`parseAttribute`, `parseXmlTree`): attributes are stored by local name only, with the namespace dropped, and a later attribute overwrites an earlier one. The reviewer reproduced it on the after-fixture: an `E: uses-permission` with `android:name="android.permission.CAMERA"` followed by `A: http://example.com/x:name="android.permission.INTERNET"` makes `judgeManifestSurface` return []. The same overwrite on `<application>` turns `android:allowBackup=true` followed by `x:allowBackup="false"` into allowBackup=false, so `judgeBackup` passes. A library manifest carrying a same-named attribute in another or no namespace could let CAMERA or `allowBackup=true` reach the release APK unflagged; whether the manifest merger and aapt2 keep such an attribute in the APK is unverified. Fix: read only the android-namespace attribute (or key by the full name), and treat a duplicate local name as an error. Taken by T3-23 (done in its branch; `scripts/tv-apk-manifest-namespace.test.ts`).
- docs/security.md:142 (§6 opening, "none of its data leaves the device through Android backup or a device-to-device transfer") and :167 ("No preference is backed up, so no credential, LAN confirmation, preference or install id is in a backup or a transfer"): both state on-device behaviour as fact with no Tested/Planned marker, though the file's opening requires one on every claim and the next bullet marks the same behaviour Planned (T4-05, T4-09). If `path="."` does not exclude a whole domain on some OEM build, security.md still says outright that no data leaves the device. Fix: mark both sentences Planned (T4-05, T4-09), or reword them as declarations. Taken by T3-23: both sentences reworded and marked Planned (T4-05, T4-09) in `docs/security.md` §6.
- scripts/tv-manifest-trim.test.ts:155-245 (frozen, item 1): the frozen tests run `trimManifest` on a hand-built template-shaped object; they never check that `expo-file-system`'s two queries or the storage permissions are gone from the merged release manifest, and the query-marker form is unfrozen. The only proof of real removal is the `tv` job's `pnpm tv:apk:check` (the medium item above). Acceptable per the spec, but item 1 is not met until that CI run exists.
- scripts/tv-apk-manifest.test.ts:284-304 (frozen, item 2) and scripts/tv-apk-manifest.mjs:292-295: the command-line tests cover only failure exits (a removed entry present, no APK). No test runs a passing CLI path, so the success summary and `tree.children` on a parsed manifest run only in the local and CI `tv:apk:check`. A later change that makes `main()` throw after `checkManifest` returns [] (for example, `manifestText` not captured because the dump arguments change) would exit non-zero on a good APK with nothing below CI catching it. Fix: a new (unfrozen) test that runs the CLI against the recorded after-fixtures through a fake `aapt2` and expects exit 0 and the summary line.
- scripts/tv-apk-manifest.test.ts:334-458 (frozen, item 3): the frozen `judgeBackup` cases use synthetic facts, and the passing exclude `path` comes from the plugin's own `DATA_EXTRACTION_RULES_XML`, so a wrong path spelling in the plugin would also pass. "A test reads the setting from the release build" is met only by the unfrozen `scripts/tv-manifest-trim-extra.test.ts` (recorded dumps) and by CI's `tv:apk:check`, and the extra test can be edited freely. Fix: pin the expected domains and `path="."` in a test that does not import the plugin's constant.
- scripts/tv-apk-manifest.test.ts:471-481 (frozen, item 5): the test checks only that the listed strings appear in §6. It would pass a §6 that names the entries but drops the removed-entry reasons, or marks on-device behaviour as Tested. No test enforces the Tested/Planned honesty of spec check note 3 (see the security.md item above). Fix: a new test that every bullet and table row in §6 carries a Tested or Planned marker, and that the backup-or-transfer behaviour is marked Planned.

Follow-ups from the T3-23 review (low, not fixed in T3-23):

- docs/specs/T3-23.md:349-360, :374, :414 (gate: review): the probe record is not a verbatim paste. In the aapt2 dump excerpt the three allowBackup lines (`android:allowBackup(0x01010280)`, `allowBackup=false`, `x:allowBackup=false`) sit under `E: uses-permission (line=30)` and no `E: application` line appears, which contradicts the merged-manifest lines 43-54 (RESOLVED 2026-11-22: the probe was run again and pasted, spec "Probe re-run"); the "kept by aapt2" answer for the application probe rests on edited output. The gate also asks for the greps pasted: the generated-manifest grep is described ("printed nothing (exit 1)"), the final-APK check is a `grep -c` count, and the milestone 4 commands are summarised, although line 300 says a check is not claimed without its output. The cleanup itself was re-checked and holds (clean status, `modules/session/android/src/main` holds only `java/`, empty grep, 0 example.com or probe. lines in the local APK dump). Fix: paste the application block and the greps as printed.
- scripts/tv-apk-manifest-namespace.test.ts:107-195 (frozen), covered only by scripts/tv-apk-manifest-namespace-extra.test.ts:53-56: the frozen tests do not pin the framework-id rule (0x01 plus six hex digits). A change of `FRAMEWORK_ID` to `/^0x[0-9a-f]{8}$/` would read a lone `http://schemas.android.com/apk/res-auto:allowBackup(0x7f01xxxx)=false` on `<application>` as false and pass, while Android reads allowBackup as absent (true); only the unfrozen extra test catches it. Also the frozen test at :184-189 (two no-namespace paths) asserts only the duplicate line, not that the first path is kept (only extra :40-51 shows that). The duplicate line still fails the build in both cases, so neither gap opens a pass today. Fix: pin both in a test that survives edits to the extra file.
- scripts/tv-apk-manifest.mjs:42-50 (`parseAttribute`): the spec ("The reading rule") says a line whose namespace URI holds `=` is unreadable and fails closed, but the attribute is split at the first `=`, so `A: x=y:name="android.permission.CAMERA" (Raw: ...)` parses as a no-namespace attribute `x`. `readXmlTree` in manifest mode returned problems=[] beside an android:name INTERNET, so the duplicate rule misses the second `name`. CORRECTION (T3-23 review): this is a bypass when the real attribute is missing. A namespace URI of `allowBackup(0x01010280)="false" x` makes `A: allowBackup(0x01010280)="false" x:foo="bar" (Raw: "bar")` read as allowBackup with a framework id and value false, so `checkManifest` returned [] for an APK with no android:allowBackup (Android reads true); `A: domain="sharedpref" x:y="z" (Raw: "z")` did the same for the rules file. The duplicate rule catches it only when the real attribute is present. Fixed in T3-23's follow-up commit: `parseAttribute` fails closed on a namespace holding `=`, a quote, `(` or whitespace, on text after the value other than a Raw copy, and on a bare value with whitespace or `=` (tests in `scripts/tv-apk-manifest-namespace-extra.test.ts`).

Further lows from the T3-23 review (not fixed):

- scripts/tv-apk-manifest-namespace.test.ts:103 (frozen, item 1): the allowBackup assertion needs only an error line holding `allowBackup` and `true`. `judgeBackup`'s absent message ("android:allowBackup is absent, which Android reads as true") matches too, so a reader that drops every allowBackup on a duplicated element passes without reading android:allowBackup=true. Acceptance item 1 still holds; add a test that pins the `true` reading.
- scripts/tv-apk-manifest-namespace.test.ts:107-195 (frozen, item 2): still open (see above); the frozen tests never pin the framework-id rule, and the two-no-namespace-paths case asserts only the duplicate line, not which path is kept.
- docs/security.md:172 (§6): said the merger and aapt2 keep `name` or `allowBackup` in another namespace or none, in an app's manifest and a library's. The library probe covered only `name` on a uses-permission; a library allowBackup was never probed and the app-level allowBackup excerpt was not verbatim. §6 and the spec record are narrowed to what was probed; the rest is unverified.
- docs/specs/T3-23.md (gate: review, item 3): done 2026-11-22, no longer a low. The probe was built again and the spec's "Probe re-run" pastes the real `E: application (line=41)` block and every grep as printed; the app-level `allowBackup` in another namespace and in none is kept by the merger and aapt2. The security.md entry above is updated to match: only a library `allowBackup` stays unverified.
- scripts/tv-aapt2-xml.mjs (`parseAttribute`): the first fix accepted any text inside `(Raw: "…")`, so `A: allowBackup(0x01010280)="false" (Raw: "x" y:foo="bar" (Raw: "bar")` still read as allowBackup false. Fixed 2026-11-22: a quoted value may hold no quote and the Raw copy must equal it.


Found by the implementer on 2026-11-22 while fixing the T3-23 review's medium (not found or graded by a reviewer; severity not reviewed, and it is the same class as that medium):

- scripts/tv-aapt2-xml.mjs (`readXmlTree`), new and not fixed: `aapt2 dump xmltree` text is read line by line, so a namespace URI holding a line break (`&#10;` in the xmlns value) could print as several whole lines, for example `A: foo=bar`, then a forged `A: …:allowBackup(0x01010280)=false`, then `A: y:real="v"`. Each line is well formed, so no rule on one line can refuse it. Like the fixed case it matters only when the real attribute is missing. Unverified: whether the manifest merger and aapt2 keep a line break in a namespace URI. Fix: read the binary XML (or aapt2's proto output) instead of the printed text, or refuse an APK whose string pool holds a namespace URI with a control character. In `tasks/backlog.jsonl`.

## Validation evidence

Milestone 1, 2026-11-21: see the spec's Implementation record, "Review record".

T3-23 review fixes, 2026-11-22 (commit fdf8bad2 and its follow-up): `pnpm check` exit 0 (97 files 2583 tests; 57 files 1242 tests; 60 node tests); `node scripts/check-red.mjs T3-23 --expect green` green [1,2,5], problems []; `node scripts/check-red.mjs T3-22 --expect green` green [1,2,3,5], problems []; `git diff --exit-code origin/main` over T3-22's three frozen files and `scripts/tv-cleartext.test.ts` exit 0; `pnpm lint:flow`: "flow ok: 13 commits ahead; frozen T3-23; 0 frozen changes"; `pnpm tv:prebuild`, `pnpm tv:build` (BUILD SUCCESSFUL), `pnpm tv:apk:check` exit 0 on the clean release APK ("2 permissions, 0 queries, backup off"). Not run: `pnpm tv:e2e` (the e2e APK is read by the same, now stricter, reader; only the release APK was read locally), `pnpm tv:smoke`, any device, and the `tv` and `checks` CI jobs on the new head (Ship phase).

## Outcome & retrospective

Open.
- 2026-11-22: merged origin/main (T3-15, PR #264) into task/T3-23; the shared reader in `scripts/tv-aapt2-xml.mjs` gained the `"any-namespace"` mode and T3-15's two readers pass a mode; the duplicate rule covers them. T3-23 stays `in_progress` until the `tv` job is green on the new head.
