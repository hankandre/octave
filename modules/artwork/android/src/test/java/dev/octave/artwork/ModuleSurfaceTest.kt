package dev.octave.artwork

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

// T3-11 acceptance item 1, the Kotlin half (docs/specs/T3-11.md, "The native module"): the artwork module's
// definition is `Name("OctaveArtwork")` and one `View(OctaveArtworkView::class)` whose block holds exactly five
// Props, session, itemId, imageType, tag and width, one `Events("onArtworkState")` and On… lifecycle hooks. The
// module defines no function, module-level event, property, constant or class. The allowlist file says the same.
// The load/ package imports no Android, AndroidX, Expo or OkHttp class, so a Swift loader can mirror it.
// scripts/tv-artwork-module.test.ts holds the same surface against docs/security.md and the TypeScript types.
class ModuleSurfaceTest {
    private val repoRoot = File(checkNotNull(System.getProperty("octave.repoRoot")) { "system property octave.repoRoot is not set" })
    private val main = File(repoRoot, "modules/artwork/android/src/main/java/dev/octave/artwork")
    private val props = listOf("session", "itemId", "imageType", "tag", "width")

    // Code only: comments may name what the definition avoids.
    private val source: String
        get() = File(main, "OctaveArtworkModule.kt").readText().replace(Regex("/\\*[\\s\\S]*?\\*/"), " ")
            .lines().joinToString("\n") { it.substringBefore("//") }

    // The body of the block that opens at the first `{` at or after `from`, or null.
    private fun blockFrom(code: String, from: Int): IntRange? {
        val open = code.indexOf('{', from)
        if (open < 0) return null
        var depth = 0
        for (i in open until code.length) {
            if (code[i] == '{') depth += 1
            if (code[i] == '}') depth -= 1
            if (depth == 0) return (open + 1) until i
        }
        return null
    }

    private fun surfaceProblems(code: String): List<String> {
        val problems = mutableListOf<String>()
        if (!code.contains("Name(\"OctaveArtwork\")")) problems += "the module is not named OctaveArtwork"
        val views = Regex("""\bView\s*\(\s*(\w+)\s*::\s*class\s*\)""").findAll(code).toList()
        if (views.map { it.groupValues[1] } != listOf("OctaveArtworkView")) problems += "views ${views.map { it.groupValues[1] }}"
        if (Regex("""(?<![\w.])View\s*\(""").findAll(code).count() != 1) problems += "a View that is not OctaveArtworkView::class"
        val viewBlock = views.firstOrNull()?.let { blockFrom(code, it.range.last) }
        if (viewBlock == null) {
            problems += "the view has no block"
            return problems
        }
        val inside = code.substring(viewBlock)
        val outside = code.removeRange(viewBlock)
        val declared = Regex("""\bProp\s*\(\s*"([^"]*)"""").findAll(inside).map { it.groupValues[1] }.toList()
        if (declared.sorted() != props.sorted()) problems += "props $declared"
        if (Regex("""\bProp\s*\(""").findAll(code).count() != props.size) problems += "a Prop without a literal name or outside the view"
        val events = Regex("""\bEvents\s*\(([^)]*)\)""").findAll(inside).map { it.groupValues[1].trim() }.toList()
        if (events != listOf("\"onArtworkState\"")) problems += "view events $events"
        if (Regex("""\bEvents\s*\(""").containsMatchIn(outside)) problems += "a module-level Events"
        val forbidden = listOf(
            "AsyncFunction", "Function(", "Property(", "Property {", "Constants(", "Constants {", "Constant(", "PropGroup",
            "StaticFunction", "StaticAsyncFunction", "Class(", "GroupView", "OnCreate", "OnStartObserving", "OnStopObserving",
            "sendEvent",
        )
        for (word in forbidden) if (Regex("""(?<![\w.])""" + Regex.escape(word)).containsMatchIn(code)) problems += word
        return problems
    }

    @Test
    fun the_definition_is_one_view_with_five_props_and_one_event() {
        assertTrue(File(main, "OctaveArtworkModule.kt").isFile, "OctaveArtworkModule.kt exists")
        assertEquals(emptyList<String>(), surfaceProblems(source))
    }

    @Test
    fun a_planted_member_fails_the_scan() {
        val code = source
        assertEquals(emptyList<String>(), surfaceProblems(code), "the scan passes the definition as it stands")
        val atModule = listOf(
            "AsyncFunction(\"load\") { promise: Promise -> promise.resolve(null) }",
            "Function(\"token\") { \"\" }",
            "Events(\"onArtworkState\")",
            "Property(\"header\") { \"\" }",
            "Constants(\"url\" to \"\")",
            "Constant(\"url\") { \"\" }",
            "Class(\"Loader\") { }",
            "OnCreate { }",
            "View(SecondView::class) { }",
        )
        for (extra in atModule) {
            val planted = code.replace("Name(\"OctaveArtwork\")", "Name(\"OctaveArtwork\")\n    $extra")
            assertTrue(planted != code, "the plant of $extra went in")
            assertTrue(surfaceProblems(planted).isNotEmpty(), "the scan sees $extra")
        }
        val view = Regex("""\bView\s*\(\s*OctaveArtworkView\s*::\s*class\s*\)\s*\{""").find(code)
        assertTrue(view != null, "the view block opens with a brace")
        val inView = listOf(
            "Prop(\"url\") { view: OctaveArtworkView, url: String -> }",
            "Prop(\"headers\") { view: OctaveArtworkView, headers: Map<String, String> -> }",
            "Prop(\"token\") { view: OctaveArtworkView, token: String -> }",
            "Prop(\"source\") { view: OctaveArtworkView, source: String -> }",
            "Prop(\"blurHash\") { view: OctaveArtworkView, hash: String -> }",
            "Events(\"onLog\")",
            "AsyncFunction(\"reload\") { view: OctaveArtworkView -> }",
        )
        for (extra in inView) {
            val at = view!!.range.last + 1
            val planted = code.substring(0, at) + "\n      $extra\n" + code.substring(at)
            assertTrue(surfaceProblems(planted).isNotEmpty(), "the scan sees $extra in the view")
        }
    }

    @Test
    fun the_allowlist_file_names_the_module_the_view_its_five_props_and_its_one_event() {
        val text = File(repoRoot, "modules/artwork/surface-allowlist.json").readText().replace(Regex("\\s"), "")
        assertTrue(text.contains("\"module\":\"OctaveArtwork\""), "module")
        assertTrue(text.contains("\"functions\":[]"), "no function")
        assertTrue(text.contains("\"name\":\"OctaveArtworkView\""), "the view")
        assertTrue(text.contains("\"props\":[\"session\",\"itemId\",\"imageType\",\"tag\",\"width\"]"), "the five props in order")
        assertTrue(text.contains("\"events\":[\"onArtworkState\"]"), "the view's one event")
        assertTrue(text.contains("\"pending\":{}"), "nothing pending")
    }

    @Test
    fun the_module_config_names_the_module_class() {
        val config = File(repoRoot, "modules/artwork/expo-module.config.json").readText()
        assertTrue(config.contains("\"dev.octave.artwork.OctaveArtworkModule\""), "expo-module.config.json names the module class")
    }

    @Test
    fun the_load_package_imports_no_platform_class() {
        val files = File(main, "load").walkTopDown().filter { it.isFile && it.name.endsWith(".kt") }.toList()
        for (name in listOf("ArtworkKey.kt", "ArtworkLoader.kt", "ArtworkDecoder.kt", "DecodeSize.kt")) {
            assertTrue(files.any { it.name == name }, "load/ holds $name")
        }
        val prefixes = listOf("import android.", "import androidx.", "import expo.", "import okhttp3.", "import com.facebook.")
        val offenders = files.filter { file -> file.readLines().any { line -> prefixes.any { line.trimStart().startsWith(it) } } }
        assertEquals(emptyList<String>(), offenders.map { it.name }, "files under load/ that import a platform class")
    }
}
