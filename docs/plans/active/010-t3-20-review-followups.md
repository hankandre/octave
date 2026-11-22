# 010: T3-20 review follow-ups

## Goal / Done when

Record the T3-20 fresh-context review's low findings so the owner and later tasks see them, and close T3-20 (T3-20). The milestones and decision log of the task itself are in `docs/specs/T3-20.md`.

- [x] Lows below logged as follow-ups, not fixed (the review found nothing to fix)
- [x] T3-20 set to done with evidence naming the commit (commit 31420255)

## Context and domains touched

Security & Redaction (the session module's one client and its resolver). The spec at `docs/specs/T3-20.md` holds the rules; `docs/security.md` section 3 ("Resolved addresses (T3-20)") holds the claims.

## Dependencies

None added.

## Milestones

1. **Log the review's lows.** Validation: `mise exec -- pnpm check`, `mise exec -- pnpm tv:native:test`. Model: sonnet.
2. **Close.** Set T3-20 to done with evidence naming the commit. Model: sonnet.

## Progress

- [x] 1
- [x] 2

## Decision log

- 2026-11-22: The review's three lows are logged, not fixed, as the workflow directed. Two concern frozen tests or the device check's strength, not the rule; the third is a wording gap in `docs/security.md`.

## Surprises & discoveries

Follow-ups (low, not fixed in T3-20):

- modules/session/android/src/test/java/dev/octave/session/http/ResolvedAddressAnswerTest.kt:154 (frozen, item 2): `a_mixed_answer_through_the_client_connects_to_the_passing_address_only` cannot tell a filtering rule from one that does not filter. OkHttp 5.5.1 turns fast fallback on by default (`javap` of `OkHttpClient$Builder.<init>`: `iconst_1`, `putfield fastFallback`), and `OctaveHttp` does not turn it off. A mutant that returns the whole answer `[203.0.113.7, 127.0.0.1]` makes OkHttp dial the TEST-NET address first, which hangs, and about 250 ms later race `127.0.0.1`, which wins: 200, one accepted connection, the case passes, and a public address was dialled, which the spec says no test does. The filter stays pinned by `a_mixed_answer_keeps_only_the_passing_addresses_in_the_resolvers_order`, which checks the list the `Dns` returns, so this is test strength, not a product defect. The spec's Risks paragraph (`docs/specs/T3-20.md`, "The HTTPS twin shows ...") is wrong to say the mixed case shows that OkHttp builds routes only from the returned list. Fix in a new test file: make the public address one that answers fast (a second listener whose accepted connections are asserted to be 0), or turn off `fastFallback` for the case.
- modules/session/android/src/androidTest/java/dev/octave/session/devicecheck/ResolvedAddressCheck.kt:38: the device MIXED case has the same blind spot. With the answer `[203.0.113.7, 10.0.2.2]` and no filtering, fast fallback still reaches `10.0.2.2` and reports `resolved-mixed=200`. So the emulator's "mixed ok" does not show that the public address was never dialled, and the comment "nothing here dials a public address" holds only if the rule works. Only the device's `resolved-public` refusal discriminates: a regression that drops the filter but keeps the all-public refusal passes `pnpm tv:e2e`. Fix: as above, a fast-answering stand-in for the public address whose connections are counted, or fast fallback off for that case.
- docs/security.md:124 ("What it does not cover", under "Resolved addresses (T3-20)"): names only a spoofed answer that points at another private LAN host. The rule also passes a loopback answer for a `.local` or `.home.arpa` name, a choice the spec's decision log settles ("A private-suffix name may resolve to loopback"). A spoofed mDNS reply that answers `127.0.0.1` for `nas.local` sends, after confirmation, the session's header and the sign-in password to whatever listens on that port on the TV, for example another app's local server. Not a regression (`Dns.SYSTEM` allowed it before). Fix: name the loopback case next to the private-host case.

## Validation evidence

Milestone 1, 2026-11-22, at 31420255:

- `mise exec -- pnpm check`: exit 0; vitest 2641 and 1431 passed; flow ok: 7 commits ahead; frozen T3-20; 0 frozen changes.
- `mise exec -- pnpm tv:native:test`: tv native: 403 tests, 0 failed, 2 projects.
- `mise exec -- node scripts/check-red.mjs T3-20 --expect green`: green [1,2,3,4,5], problems [].
- `ANDROID_SERIAL=emulator-5592 mise exec -- pnpm tv:e2e` on a fresh read-only `fluster_tv` emulator of this agent's own (API 36), stopped after: exit 0; `url 202/202, device-id 13/13, host ok`; `cleartext private-lan ok, loopback ok, public 60/60 refused`; `resolved-address private ok, mixed ok, public refused` (see the second follow-up for what "mixed ok" does not show).

Not run: the Shield, any physical TV, arm64, other Android versions or AVDs, real mDNS or `.home.arpa` resolvers, device HTTPS with a real certificate, the dogfood servers. `pnpm tv:wire --task T3-05` not rerun here (no code change since its 8-pair pass on this branch).

## Outcome & retrospective

Open.
