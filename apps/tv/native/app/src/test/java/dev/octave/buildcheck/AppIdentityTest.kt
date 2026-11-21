package dev.octave.buildcheck

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

// The application ID Gradle builds with is the one the core defines (packages/core/src/domain/app-identity.ts), so
// prebuild takes it from nowhere else and T11-01 can change it in one place.
class AppIdentityTest {
    @Test
    fun applicationIdComesFromTheCore() {
        val identity = BuildCheck.repoRoot.resolve("packages/core/src/domain/app-identity.ts").readText()
        val match = Regex("""export const ANDROID_APPLICATION_ID = "([^"]+)";""").find(identity)
        val core = checkNotNull(match) { "app-identity.ts defines no ANDROID_APPLICATION_ID" }.groupValues[1]
        assertEquals(core, BuildCheck.property("octave.applicationId"))
    }
}
