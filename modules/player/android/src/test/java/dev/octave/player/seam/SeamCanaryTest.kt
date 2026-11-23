package dev.octave.player.seam

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.PrintStream

// T8-01 acceptance item 7 (docs/specs/T8-01.md): the play-session id and item ids appear in no log or event payload
// beyond what the port defines. A launch carries a play-session canary and an item-id canary in its URLs; a fake
// engine emits every event kind and then throws with both canaries in its message. No result and no emitted map holds
// either, standard output and error hold neither, LaunchRequest's debug form is redacted, and the module's main
// Kotlin has no log call.
class SeamCanaryTest {
    private val play = "playsession-canary-5c1e"
    private val item = "itemid-canary-9b2d"
    private val canaries = listOf(play, item)

    private fun canaryLaunch(): MutableMap<String, Any?> =
        Samples.original(url = "https://media.test/Videos/$item/stream?Static=true&MediaSourceId=$item&PlaySessionId=$play").apply {
            this["tracks"] = listOf(
                Samples.audioTrack(),
                Samples.subtitleTrack("https://media.test/Videos/$item/$item/Subtitles/3/0/Stream.vtt?PlaySessionId=$play"),
            )
        }

    private fun assertNoCanary(text: String, where: String) {
        for (canary in canaries) assertFalse(text.contains(canary), "$where holds $canary")
    }

    @Test
    fun no_result_event_or_output_holds_a_canary() {
        val captured = ByteArrayOutputStream()
        val capture = PrintStream(captured, true, "UTF-8")
        val out = System.out
        val err = System.err
        val emitted = mutableListOf<Map<String, Any?>>()
        val results = mutableListOf<Map<String, Any?>>()
        val engine = FakeEngine()
        engine.onLaunch = { fake -> for (event in Samples.everyKind()) fake.emit(event) }
        System.setOut(capture)
        System.setErr(capture)
        try {
            val seam = PlayerSeam(engine, SessionCheck { true }, { emitted += it })
            results += seam.initialize()
            results += seam.launch(canaryLaunch())
            assertEquals(1, engine.launched.size, "the canary launch reached the engine")
            println(engine.launched.single())
            engine.onLaunch = {}
            engine.failure = RuntimeException("Source error at https://media.test/Videos/$item/stream?PlaySessionId=$play", IllegalStateException("$item $play"))
            results += seam.launch(canaryLaunch())
            results += seam.setPaused(mapOf("paused" to true))
            results += seam.seek(mapOf("positionSeconds" to 1.0))
            results += seam.selectTrack(mapOf("type" to "audio", "playerId" to 1.0))
            results += seam.stop()
            results += seam.initialize()
        } finally {
            System.setOut(out)
            System.setErr(err)
        }
        assertEquals(Samples.everyKind().size, emitted.size, "every kind was emitted")
        assertEquals(mapOf("error" to "unknown"), results[2])
        assertNoCanary(results.toString(), "a result")
        assertNoCanary(emitted.toString(), "an emitted map")
        assertNoCanary(captured.toString("UTF-8"), "standard output or error")
    }

    @Test
    fun the_launch_requests_debug_form_is_redacted() {
        val request = LaunchRequestReader.read(canaryLaunch())
        assertTrue(request != null, "the canary launch is read")
        assertEquals("LaunchRequest([redacted])", request.toString())
        val hls = LaunchRequestReader.read(
            Samples.hls().apply { this["masterUrl"] = "https://media.test/jellyfin/videos/$item/master.m3u8?PlaySessionId=$play" },
        )
        assertTrue(hls != null, "the canary HLS launch is read")
        assertNoCanary(hls.toString(), "the HLS request's debug form")
    }

    @Test
    fun the_modules_main_kotlin_has_no_log_call() {
        val main = File(Samples.repoRoot, "modules/player/android/src/main")
        val files = main.walkTopDown().filter { it.isFile && (it.name.endsWith(".kt") || it.name.endsWith(".java")) }.toList()
        assertTrue(files.any { it.name == "PlayerSeam.kt" } && files.any { it.name == "OctavePlayerModule.kt" }, "the scan reads the module's main source")
        val words = listOf(
            Regex("""\bandroid\.util\.Log\b"""),
            Regex("""\bLog\s*\.\s*[a-z]+\s*\("""),
            Regex("""\bprintln\s*\("""),
            Regex("""\bprint\s*\("""),
            Regex("""\bSystem\s*\.\s*(out|err)\b"""),
            Regex("""\bprintStackTrace\s*\("""),
            Regex("""\bLogger\b"""),
            Regex("""\bTimber\b"""),
            Regex("""\bHttpLoggingInterceptor\b"""),
            Regex("""\bEventLogger\b"""),
        )
        for (file in files) {
            val code = file.readText().replace(Regex("/\\*[\\s\\S]*?\\*/"), " ").lines().joinToString("\n") { it.substringBefore("//") }
            for (word in words) assertFalse(word.containsMatchIn(code), "${file.name} has a log call: ${word.pattern}")
        }
    }
}
