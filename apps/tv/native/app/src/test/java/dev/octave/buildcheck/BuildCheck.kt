package dev.octave.buildcheck

import java.io.File

// The system properties apps/tv/plugins/with-app-jvm-tests.js gives the test JVM.
internal object BuildCheck {
    fun property(name: String): String =
        checkNotNull(System.getProperty(name)) { "system property $name is not set; run the tests through pnpm tv:native:test" }

    val repoRoot: File get() = File(property("octave.repoRoot"))
}
