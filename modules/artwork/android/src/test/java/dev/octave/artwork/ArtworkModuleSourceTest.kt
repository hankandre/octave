package dev.octave.artwork

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

// T3-11 acceptance item 2, the module half (docs/specs/T3-11.md, D2; spec check issue 9): the artwork module opens
// no network path of its own. Its main Kotlin names no okhttp3, java.net or javax.net class, in an import or written
// out in full, and its Gradle file declares no OkHttp; every image request goes through the session module's
// ArtworkFetch. It never recycles a bitmap, since a mounted view may still draw one the cache evicted.
class ArtworkModuleSourceTest {
    private val repoRoot = File(checkNotNull(System.getProperty("octave.repoRoot")) { "system property octave.repoRoot is not set" })
    private val moduleRoot = File(repoRoot, "modules/artwork/android")
    private val main = File(moduleRoot, "src/main")

    private fun code(file: File): String =
        file.readText().replace(Regex("/\\*[\\s\\S]*?\\*/"), " ").lines().joinToString("\n") { it.substringBefore("//") }

    private fun mainFiles(): List<File> =
        main.walkTopDown().filter { it.isFile && (it.name.endsWith(".kt") || it.name.endsWith(".java")) }.toList()

    private fun networkProblems(files: Map<String, String>): List<String> =
        files.flatMap { (name, text) ->
            listOf("okhttp3.", "java.net.", "javax.net.").filter { text.contains(it) }.map { "$name names $it" }
        }

    @Test
    fun the_scan_reads_the_modules_sources() {
        val names = mainFiles().map { it.name }
        for (name in listOf("OctaveArtworkModule.kt", "OctaveArtworkView.kt", "BitmapArtworkDecoder.kt", "ArtworkLoader.kt")) {
            assertTrue(name in names, "src/main holds $name")
        }
    }

    @Test
    fun no_main_source_names_okhttp_java_net_or_javax_net() {
        val files = mainFiles().associate { it.name to code(it) }
        assertTrue(files.isNotEmpty(), "the module has main sources")
        assertEquals(emptyList<String>(), networkProblems(files))
        for (plant in listOf("import okhttp3.OkHttpClient", "val url = java.net.URL(\"x\")", "import javax.net.ssl.SSLSocketFactory")) {
            assertTrue(networkProblems(mapOf("Planted.kt" to plant)).isNotEmpty(), "the scan sees $plant")
        }
    }

    @Test
    fun the_gradle_file_declares_no_okhttp_and_depends_on_the_session_project() {
        val gradle = code(File(moduleRoot, "build.gradle"))
        assertFalse(gradle.lowercase().contains("okhttp"), "build.gradle names no OkHttp artifact")
        assertTrue(gradle.contains("project(':octave-session')"), "build.gradle depends on the session module")
    }

    @Test
    fun no_main_source_recycles_a_bitmap() {
        val offenders = mainFiles().filter { Regex("""\.\s*recycle\s*\(""").containsMatchIn(code(it)) }.map { it.name }
        assertEquals(emptyList<String>(), offenders, "files that call recycle()")
    }
}
