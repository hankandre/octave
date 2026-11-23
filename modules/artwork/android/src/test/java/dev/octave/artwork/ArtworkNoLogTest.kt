package dev.octave.artwork

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

// T3-11 acceptance item 6, the Kotlin half (docs/specs/T3-11.md, "Invariants and hard rules touched"): the artwork
// module logs nothing. No main Kotlin or Java file calls android.util.Log, println or print, System.out or
// System.err, Timber, a logger, or printStackTrace. pnpm lint:logs, with modules/artwork in its roots, holds the
// same files with its own patterns.
class ArtworkNoLogTest {
    private val repoRoot = File(checkNotNull(System.getProperty("octave.repoRoot")) { "system property octave.repoRoot is not set" })
    private val main = File(repoRoot, "modules/artwork/android/src/main")

    private val logCalls = listOf(
        Regex("""\bLog\s*\.\s*(?:v|d|i|w|e|wtf|println)\s*\("""),
        Regex("""(?<![\w$.])(?:println|print)\s*\("""),
        Regex("""\bSystem\s*\.\s*(?:out|err)\b"""),
        Regex("""\bTimber\b"""),
        Regex("""(?<![\w$])[lL]ogger\s*\.\s*\w+\s*\("""),
        Regex("""\bprintStackTrace\s*\("""),
        Regex("""\bimport\s+android\.util\.Log\b"""),
    )

    private fun code(text: String): String =
        text.replace(Regex("/\\*[\\s\\S]*?\\*/"), " ").lines().joinToString("\n") { it.substringBefore("//") }

    private fun logProblems(name: String, text: String): List<String> =
        logCalls.filter { it.containsMatchIn(code(text)) }.map { "$name: ${it.pattern}" }

    @Test
    fun no_main_source_logs() {
        val files = main.walkTopDown().filter { it.isFile && (it.name.endsWith(".kt") || it.name.endsWith(".java")) }.toList()
        assertTrue(files.any { it.name == "OctaveArtworkView.kt" }, "the scan reads the view")
        assertTrue(files.any { it.name == "ArtworkLoader.kt" }, "the scan reads the loader")
        assertEquals(emptyList<String>(), files.flatMap { logProblems(it.name, it.readText()) })
    }

    @Test
    fun a_planted_log_call_fails_the_scan() {
        val plants = listOf(
            "android.util.Log.d(\"Artwork\", \"loaded\")",
            "Log.w(TAG, \"failed\")",
            "println(key)",
            "System.err.println(error)",
            "Timber.d(\"x\")",
            "logger.info(\"x\")",
            "error.printStackTrace()",
        )
        for (plant in plants) assertTrue(logProblems("Planted.kt", "fun f() { $plant }").isNotEmpty(), "the scan sees $plant")
        assertEquals(emptyList<String>(), logProblems("Comment.kt", "// Log.d(\"x\", \"y\") is never called\nfun f() = Unit"))
    }
}
