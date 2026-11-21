# T3-03 decisions

## Does MockWebServer pass the no-maintenance-mode dependency rule?

Decided by the owner on 2026-11-21.

Yes, as a test-only dependency. Adopt `com.squareup.okhttp3:mockwebserver3` 5.5.1 for the JVM tests named in acceptance item 8. It never ships in the APK.

Why: its README says it "is not being actively developed for new features", but that is a feature freeze, not maintenance mode. It is not archived, it ships with every OkHttp release (5.5.1 on 2026-10-22), and fixes still land (a fix commit on 2026-11-21).

Conditions:
- Keep it on a watch list and re-read its status at the next phase check.
- If it is archived, dropped from OkHttp releases, or stops getting fixes, replace it. The fallback is a small hand-written server on `java.net.ServerSocket`.

## Does androidx.startup:startup-runtime pass the no-maintenance-mode rule?

Decided 2026-11-21 by the coordinator; the owner may veto it.

Yes. OkHttp 5's Android variant depends on `androidx.startup:startup-runtime` 1.2.0 (released 2024-09-18). It is not a new library: the T3-02 release APK already ships version 1.1.1, pulled in by the AndroidX libraries React Native uses. OkHttp 5 only moves it from 1.1.1 to 1.2.0. It is a small, finished AndroidX library in an active repository (androidx/androidx, not archived), with no maintenance-mode or supersession statement found. Keep it on watch with the other AndroidX libraries, and re-read it at the next phase check.

## Align React Native's okhttp-urlconnection with OkHttp 5.5.1 (backlog line 164)

Decided 2026-11-21 by the coordinator; the owner may veto it.

Keep the alignment. `modules/session` declares `platform("com.squareup.okhttp3:okhttp-bom:5.5.1")`, which moves React Native's `okhttp-urlconnection` from 4.9.2 to 5.5.1. Without it, React Native's cookie jar calls `okhttp3.internal.Util`, which OkHttp 5 removed, and a request to a host with a stored cookie throws `NoClassDefFoundError`. `CookieJarLinkTest` fails before the change and passes after it. Gradle resolves the Android variant (`okhttp-android` 5.5.1, no `okhttp-jvm`). The BOM is a list of version constraints from the same OkHttp release, with no code.

Fencing React Native's networking instead is a larger scope question. It belongs to the Product Owner's ruling on which task fences the React Native and Expo clients (backlog line 162), not to this fix.
