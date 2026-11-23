package dev.octave.artwork

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

// T3-39 acceptance items 5 and 4 (docs/specs/T3-39.md, "Dependencies", "The preview loader" and Test plan): the
// BlurHash decoder is the module's own plain-Kotlin code, not a dependency, and the preview path makes no request.
// - load/BlurHash.kt and load/PreviewLoader.kt exist and import no android., androidx., expo., okhttp3., java.net. or
//   javax.net. class, so a Swift implementation can mirror them.
// - OctaveArtworkView.kt never calls BlurHash.decode itself; it reaches the decoder only through the runtime's
//   PreviewLoader.
// - build.gradle's dependencies block is still exactly project(':octave-session') and the JUnit BOM test lines.
// - No file under src/main imports a blurhash package other than the module's own (dev.octave.artwork).
// - PreviewLoader's constructor takes no fetch, request, session or PreparedArtwork.
// The frozen ArtworkModuleSourceTest (T3-11) still holds that no main source names okhttp3., java.net. or javax.net.
class PreviewSourceTest {
    private val repoRoot = File(checkNotNull(System.getProperty("octave.repoRoot")) { "system property octave.repoRoot is not set" })
    private val moduleRoot = File(repoRoot, "modules/artwork/android")
    private val main = File(moduleRoot, "src/main")
    private val pkg = File(main, "java/dev/octave/artwork")

    // Code only: comments may name what the code avoids.
    private fun code(file: File): String =
        file.readText().replace(Regex("/\\*[\\s\\S]*?\\*/"), " ").lines().joinToString("\n") { it.substringBefore("//") }

    private fun mainFiles(): List<File> =
        main.walkTopDown().filter { it.isFile && (it.name.endsWith(".kt") || it.name.endsWith(".java")) }.toList()

    @Test
    fun the_decoder_and_the_loader_are_plain_kotlin_under_load() {
        val prefixes = listOf("android.", "androidx.", "expo.", "okhttp3.", "java.net.", "javax.net.", "com.facebook.")
        for (name in listOf("BlurHash.kt", "PreviewLoader.kt")) {
            val file = File(pkg, "load/$name")
            assertTrue(file.isFile, "load/$name exists")
            val imports = code(file).lines().map { it.trim() }.filter { it.startsWith("import ") }.map { it.removePrefix("import ").trim() }
            val offenders = imports.filter { line -> prefixes.any { line.startsWith(it) } }
            assertEquals(emptyList<String>(), offenders, "platform imports in load/$name")
            val written = prefixes.filter { code(file).contains(it) }
            assertEquals(emptyList<String>(), written, "platform classes written out in full in load/$name")
        }
    }

    @Test
    fun the_view_does_not_decode_a_hash_itself() {
        val view = code(File(pkg, "OctaveArtworkView.kt"))
        assertFalse(Regex("""\bBlurHash\s*(\.|::)\s*decode\b""").containsMatchIn(view), "OctaveArtworkView.kt calls BlurHash.decode")
        val callers = mainFiles().filter { Regex("""\bBlurHash\s*(\.|::)\s*decode\b""").containsMatchIn(code(it)) }.map { it.name }
        assertTrue(callers.isNotEmpty(), "some main source wires BlurHash.decode into the preview path")
        assertFalse("OctaveArtworkView.kt" in callers, "the view is not a caller of BlurHash.decode")
    }

    @Test
    fun the_gradle_dependencies_are_still_the_session_project_and_the_junit_pins() {
        val gradle = File(moduleRoot, "build.gradle").readText().lines().joinToString("\n") { it.substringBefore("//") }
        val start = Regex("""(?m)^dependencies\s*\{""").find(gradle)
        assertTrue(start != null, "build.gradle has a top-level dependencies block")
        val open = start!!.range.last
        var depth = 0
        var close = -1
        for (i in open until gradle.length) {
            if (gradle[i] == '{') depth += 1
            if (gradle[i] == '}') depth -= 1
            if (depth == 0) {
                close = i
                break
            }
        }
        assertTrue(close > open, "the dependencies block closes")
        val lines = gradle.substring(open + 1, close).lines().map { it.trim().replace(Regex("\\s+"), " ") }.filter { it.isNotEmpty() }
        assertEquals(
            listOf(
                "implementation project(':octave-session')",
                "testImplementation platform(junitBom)",
                "testImplementation \"org.junit.jupiter:junit-jupiter\"",
                "testRuntimeOnly \"org.junit.platform:junit-platform-launcher\"",
            ),
            lines,
        )
        assertEquals(1, Regex("""(?m)^\s*dependencies\s*\{""").findAll(gradle).count(), "one dependencies block")
        assertFalse(gradle.lowercase().contains("blurhash"), "build.gradle names no BlurHash artifact")
    }

    @Test
    fun no_main_source_imports_a_blurhash_package_other_than_the_modules_own() {
        val offenders = mainFiles().flatMap { file ->
            code(file).lines().map { it.trim() }
                .filter { it.startsWith("import ") && it.lowercase().contains("blurhash") && !it.startsWith("import dev.octave.artwork.") }
                .map { "${file.name}: $it" }
        }
        assertEquals(emptyList<String>(), offenders)
        val written = mainFiles().filter { file ->
            Regex("""\b[a-z]\w*(\.[a-z]\w*)*\.blurhash\.""").containsMatchIn(code(file))
        }.map { it.name }
        assertEquals(emptyList<String>(), written, "a blurhash package written out in full")
    }

    @Test
    fun the_preview_loader_takes_no_fetch_request_or_session() {
        val source = code(File(pkg, "load/PreviewLoader.kt"))
        val start = Regex("""\bclass\s+PreviewLoader\s*(?:internal\s+|public\s+)?(?:constructor\s*)?\(""").find(source)
        assertTrue(start != null, "PreviewLoader.kt declares class PreviewLoader(...)")
        val open = start!!.range.last
        var depth = 0
        var close = -1
        for (i in open until source.length) {
            if (source[i] == '(') depth += 1
            if (source[i] == ')') depth -= 1
            if (depth == 0) {
                close = i
                break
            }
        }
        val parameters = source.substring(open + 1, close)
        for (word in listOf("PreparedArtwork", "ArtworkFetch", "ArtworkRequest", "ArtworkLoader", "SessionId", "fetch", "source", "session", "Url", "url")) {
            assertFalse(parameters.contains(word), "PreviewLoader's constructor names $word")
        }
        for (word in listOf("PreparedArtwork", "ArtworkFetch", "ArtworkRequest", "SessionId", "SessionRegistry")) {
            assertFalse(Regex("""\b$word\b""").containsMatchIn(source), "PreviewLoader.kt names $word")
        }
    }
}
