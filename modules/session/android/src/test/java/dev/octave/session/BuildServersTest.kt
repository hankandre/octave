package dev.octave.session

import android.content.pm.ApplicationInfo
import dev.octave.session.http.HttpRefusal
import dev.octave.session.http.OctaveHttpException
import dev.octave.session.http.ServerAddress
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.fail
import org.junit.jupiter.api.Test
import java.io.File

// T3-33 item 1, review finding: the app's FLAG_DEBUGGABLE is the one input that makes a build a development build.
// BuildServers.of turns the flags OctaveSessionModule reads into the rule, and the module decides only through it, from
// applicationInfo.flags, never from a BuildConfig.DEBUG.
class BuildServersTest {
    private val home = ServerAddress.parse("http://media.home.arpa:8096")
    private val emulator = ServerAddress.parse("http://10.0.2.2:8096")
    private val otherBits = ApplicationInfo.FLAG_ALLOW_BACKUP or ApplicationInfo.FLAG_HAS_CODE

    private fun refuses(flags: Int?, address: ServerAddress, allowlist: String = ""): Boolean {
        return try {
            BuildServers.of(flags, allowlist).check(address)
            false
        } catch (error: OctaveHttpException) {
            assertEquals(HttpRefusal.DEVELOPMENT_BUILD, error.refusal)
            true
        }
    }

    @Test
    fun a_debuggable_app_follows_the_development_rule() {
        for (flags in listOf(ApplicationInfo.FLAG_DEBUGGABLE, ApplicationInfo.FLAG_DEBUGGABLE or otherBits)) {
            assertTrue(refuses(flags, home), "flags $flags refuse a home-network name")
            assertFalse(refuses(flags, emulator), "flags $flags admit the emulator host")
            assertFalse(refuses(flags, home, "media.home.arpa"), "flags $flags admit a listed host")
        }
    }

    @Test
    fun an_app_that_is_not_debuggable_follows_the_release_rule() {
        for (flags in listOf(0, otherBits, otherBits and ApplicationInfo.FLAG_DEBUGGABLE.inv())) {
            assertFalse(refuses(flags, home), "flags $flags admit a home-network name")
            assertFalse(refuses(flags, emulator), "flags $flags admit the emulator host")
        }
    }

    @Test
    fun no_flags_to_read_counts_as_a_development_build() {
        assertTrue(refuses(null, home), "no flags refuse a home-network name")
        assertFalse(refuses(null, emulator), "no flags admit the emulator host")
    }

    // Code only: comments may name what the module avoids.
    private val moduleSource: String
        get() {
            val root = File(checkNotNull(System.getProperty("octave.repoRoot")) { "system property octave.repoRoot is not set" })
            val file = File(root, "modules/session/android/src/main/java/dev/octave/session/OctaveSessionModule.kt")
            return file.readLines().joinToString("\n") { it.substringBefore("//") }
        }

    @Test
    fun the_module_decides_only_from_the_app_flags() {
        val source = moduleSource
        val calls = Regex("""BuildServers\.of\(([^,]*),""").findAll(source).map { it.groupValues[1].trim() }.toList()
        assertEquals(listOf("null", "context.applicationInfo.flags"), calls, "the module's calls of BuildServers.of")
        for (word in listOf("DevelopmentServers", "FLAG_DEBUGGABLE", "BuildConfig.DEBUG", "BuildConfig.BUILD_TYPE")) {
            if (source.contains(word)) fail<Unit>("OctaveSessionModule names $word; it decides only through BuildServers.of")
        }
    }
}
