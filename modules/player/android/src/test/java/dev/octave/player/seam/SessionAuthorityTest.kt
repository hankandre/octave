package dev.octave.player.seam

import dev.octave.player.RegistrySessionCheck
import dev.octave.session.http.SessionId
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

// T8-01 acceptance item 3 (docs/specs/T8-01.md, "The Kotlin seam"): the player module gets its authority to send the
// header from native code, never from an argument. A launch names a session id; PlayerSeam asks the session check
// (in the app, SessionRegistry.holds through RegistrySessionCheck) whether it is held, and answers session-ended when
// it is not, before any engine is called. The request an engine receives holds the SessionId and nothing that is a
// header. A header, token or option key is refused as unsupported-request before the check is asked. No main file of
// the module names a header, a token or a registry entry; RegistrySessionCheck.kt's `SessionRegistry.holds` is the
// one registry reference (spec check issue 4).
class SessionAuthorityTest {
    private val unsupported = mapOf("error" to "unsupported-request")
    private val sessionEnded = mapOf("error" to "session-ended")

    private class RecordingCheck(val answer: Boolean) : SessionCheck {
        val asked = mutableListOf<SessionId>()

        override fun holds(session: SessionId): Boolean {
            asked += session
            return answer
        }
    }

    @Test
    fun a_session_the_registry_does_not_hold_ends_the_launch_before_the_engine_is_called() {
        val engine = FakeEngine()
        val check = RecordingCheck(false)
        val seam = PlayerSeam(engine, check, {})
        assertEquals(sessionEnded, seam.launch(Samples.original()))
        assertEquals(sessionEnded, seam.launch(Samples.hls()))
        assertEquals(listOf(SessionId.parse(Samples.SESSION), SessionId.parse(Samples.SESSION)), check.asked)
        assertTrue(engine.launched.isEmpty(), "the engine was not called")
        assertFalse(engine.calls.contains("launch"), "the engine was not called")
    }

    @Test
    fun a_held_session_reaches_the_engine_as_a_session_id_only() {
        val engine = FakeEngine()
        val check = RecordingCheck(true)
        val seam = PlayerSeam(engine, check, {})
        assertEquals(emptyMap<String, Any?>(), seam.launch(Samples.original()))
        assertEquals(listOf(SessionId.parse(Samples.SESSION)), check.asked)
        assertEquals(SessionId.parse(Samples.SESSION), engine.launched.single().session)
    }

    @Test
    fun without_an_engine_a_held_session_is_unsupported_and_an_unheld_one_is_session_ended() {
        assertEquals(unsupported, PlayerSeam(null, RecordingCheck(true), {}).launch(Samples.original()))
        assertEquals(sessionEnded, PlayerSeam(null, RecordingCheck(false), {}).launch(Samples.original()))
    }

    @Test
    fun a_header_token_or_option_key_is_refused_before_the_session_is_asked() {
        val keys = listOf("headers", "header", "authorization", "Authorization", "token", "accessToken", "apiKey", "options", "httpHeaders")
        for (key in keys) {
            for (base in listOf(Samples.original(), Samples.hls())) {
                val engine = FakeEngine()
                val check = RecordingCheck(true)
                val seam = PlayerSeam(engine, check, {})
                val topLevel = HashMap(base).apply { this[key] = "MediaBrowser Token=\"x\"" }
                assertEquals(unsupported, seam.launch(topLevel), "$key at the top level")
                val inTrack = HashMap(base).apply { this["tracks"] = listOf(Samples.audioTrack().apply { this[key] = "x" }) }
                assertEquals(unsupported, seam.launch(inTrack), "$key in a track")
                assertTrue(check.asked.isEmpty(), "the session was not asked for $key")
                assertTrue(engine.launched.isEmpty(), "the engine was not called for $key")
            }
        }
    }

    @Test
    fun a_malformed_session_id_is_refused_as_a_shape_not_asked() {
        val check = RecordingCheck(true)
        val engine = FakeEngine()
        val seam = PlayerSeam(engine, check, {})
        for (id in listOf("", "session-1", Samples.SESSION.uppercase(), Samples.SESSION + "0")) {
            assertEquals(unsupported, seam.launch(Samples.original(session = id)), "the id \"$id\"")
        }
        assertTrue(check.asked.isEmpty())
        assertTrue(engine.launched.isEmpty())
    }

    @Test
    fun the_registry_check_answers_false_for_an_id_no_session_opened() {
        val id = SessionId.parse("0123456789abcdef0123456789abcdef")!!
        assertFalse(RegistrySessionCheck.holds(id), "a parsed id that no sign-in opened is not held")
    }

    private val main: File
        get() = File(Samples.repoRoot, "modules/player/android/src/main")

    private fun code(file: File): String =
        file.readText().replace(Regex("/\\*[\\s\\S]*?\\*/"), " ").lines().joinToString("\n") { it.substringBefore("//") }

    @Test
    fun no_main_file_of_the_module_names_a_header_a_token_or_a_registry_entry() {
        val files = main.walkTopDown().filter { it.isFile && (it.name.endsWith(".kt") || it.name.endsWith(".java")) }.toList()
        val names = files.map { it.name }.toSet()
        for (expected in listOf("PlayerSeam.kt", "PlaybackEngine.kt", "LaunchRequestReader.kt", "RegistrySessionCheck.kt", "OctavePlayerModule.kt")) {
            assertTrue(expected in names, "the scan reads $expected")
        }
        val words = listOf(
            Regex("header", RegexOption.IGNORE_CASE),
            Regex("token", RegexOption.IGNORE_CASE),
            Regex("authorization", RegexOption.IGNORE_CASE),
            Regex("""\bSessionEntry\b"""),
            Regex("""\bMediaBrowser\w*"""),
            Regex("\\\$octave"),
        )
        for (file in files) {
            val text = code(file)
            for (word in words) assertFalse(word.containsMatchIn(text), "${file.name} names ${word.pattern}")
            val registry = Regex("""\bSessionRegistry\b(\s*\.\s*\w+)?""").findAll(text).map { it.value.replace(Regex("\\s"), "") }.toList()
            if (file.name == "RegistrySessionCheck.kt") {
                assertTrue(registry.isNotEmpty() && registry.all { it == "SessionRegistry.holds" }, "RegistrySessionCheck.kt uses SessionRegistry.holds only: $registry")
            } else {
                assertEquals(emptyList<String>(), registry, "${file.name} names the registry")
            }
        }
    }
}
