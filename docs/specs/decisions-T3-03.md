# T3-03 decisions

## Does MockWebServer pass the no-maintenance-mode dependency rule?

Decided by the owner on 2026-11-21.

Yes, as a test-only dependency. Adopt `com.squareup.okhttp3:mockwebserver3` 5.5.1 for the JVM tests named in acceptance item 8. It never ships in the APK.

Why: its README says it "is not being actively developed for new features", but that is a feature freeze, not maintenance mode. It is not archived, it ships with every OkHttp release (5.5.1 on 2026-10-22), and fixes still land (a fix commit on 2026-11-21).

Conditions:
- Keep it on a watch list and re-read its status at the next phase check.
- If it is archived, dropped from OkHttp releases, or stops getting fixes, replace it. The fallback is a small hand-written server on `java.net.ServerSocket`.
