package dev.octave.player

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

// T8-01 acceptance item 1, the Kotlin half (docs/specs/T8-01.md, "The JavaScript surface"): the player module's
// JavaScript surface is exactly the PlayerEngine port's six commands as AsyncFunctions, one event, playerEvent (the
// port's subscribe), and one view, OctavePlayerView, with no prop; no Function, Property, Constant, Constants,
// PropGroup, StaticFunction, StaticAsyncFunction, Class, OnCreate or second event, and no sendEvent with another
// name. The seam package imports no Android, AndroidX, Expo, OkHttp or React Native class, so a Swift engine can
// mirror it. scripts/tv-module-surfaces.test.ts holds the same surface against the allowlist file and
// docs/security.md.
class ModuleSurfaceTest {
    private val repoRoot = File(checkNotNull(System.getProperty("octave.repoRoot")) { "system property octave.repoRoot is not set" })
    private val main = File(repoRoot, "modules/player/android/src/main/java/dev/octave/player")

    // Code only: comments may name what the definition avoids.
    private val source: String
        get() = File(main, "OctavePlayerModule.kt").readText().replace(Regex("/\\*[\\s\\S]*?\\*/"), " ")
            .lines().joinToString("\n") { it.substringBefore("//") }

    private val functions = listOf("initialize", "launch", "setPaused", "seek", "selectTrack", "stop")

    private fun surfaceProblems(source: String): List<String> {
        val problems = mutableListOf<String>()
        val asyncFunctions = Regex("""\bAsyncFunction\s*\(\s*"([^"]*)"""").findAll(source).map { it.groupValues[1] }.toList()
        if (asyncFunctions.sorted() != functions.sorted()) problems += "functions $asyncFunctions"
        if (Regex("""\bAsyncFunction\s*\(""").findAll(source).count() != functions.size) problems += "an AsyncFunction without a literal name"
        if (Regex("""(?<![\w.])Function\s*\(""").containsMatchIn(source)) problems += "a synchronous Function"
        val events = Regex("""\bEvents\s*\(([^)]*)\)""").findAll(source).map { it.groupValues[1].trim() }.toList()
        if (events != listOf("\"playerEvent\"")) problems += "events $events"
        val views = Regex("""\bView\s*\(\s*(\w+)\s*::\s*class\s*\)""").findAll(source).map { it.groupValues[1] }.toList()
        if (views != listOf("OctavePlayerView")) problems += "views $views"
        if (Regex("""\bView\s*\(""").findAll(source).count() != 1) problems += "a View that is not OctavePlayerView::class"
        val sent = Regex("""\bsendEvent\s*\(\s*([^,)]*)""").findAll(source).map { it.groupValues[1].trim() }.toList()
        if (sent.any { it != "\"playerEvent\"" }) problems += "sendEvent $sent"
        if (!source.contains("Name(\"OctavePlayer\")")) problems += "the module is not named OctavePlayer"
        val forbidden = listOf(
            "Property(", "Property {", "Constants(", "Constants {", "Constant(", "Prop(", "PropGroup", "StaticFunction",
            "StaticAsyncFunction", "Class(", "GroupView", "OnCreate", "OnStartObserving", "OnStopObserving",
        )
        for (word in forbidden) if (Regex("""(?<![\w.])""" + Regex.escape(word)).containsMatchIn(source)) problems += word
        return problems
    }

    @Test
    fun the_module_definition_is_the_ports_six_functions_one_event_and_one_view() {
        assertTrue(File(main, "OctavePlayerModule.kt").isFile, "OctavePlayerModule.kt exists")
        assertEquals(emptyList<String>(), surfaceProblems(source))
    }

    @Test
    fun a_planted_member_fails_the_scan() {
        val plants = listOf(
            "AsyncFunction(\"setVolume\") { promise: Promise -> promise.resolve(null) }",
            "Function(\"token\") { \"\" }",
            "Events(\"progress\")",
            "Property(\"header\") { \"\" }",
            "Constants(\"url\" to \"\")",
            "Constant(\"url\") { \"\" }",
            "Prop(\"url\") { view: OctavePlayerView, url: String -> }",
            "PropGroup(\"source\", \"uri\") { view: OctavePlayerView, value: String -> }",
            "StaticFunction(\"make\") { }",
            "Class(\"Player\") { }",
            "OnCreate { }",
            "View(SecondView::class) { }",
        )
        for (extra in plants) {
            val planted = source.replace("Name(\"OctavePlayer\")", "Name(\"OctavePlayer\")\n    $extra")
            assertTrue(planted != source, "the plant of $extra went in")
            assertTrue(surfaceProblems(planted).isNotEmpty(), "the scan sees $extra")
        }
        val stray = "$source\nfun stray() { sendEvent(\"log\", mapOf<String, Any>()) }"
        assertTrue(surfaceProblems(stray).isNotEmpty(), "the scan sees a sendEvent outside playerEvent")
    }

    @Test
    fun the_module_config_names_the_module_class() {
        val config = File(repoRoot, "modules/player/expo-module.config.json").readText()
        assertTrue(config.contains("\"dev.octave.player.OctavePlayerModule\""), "expo-module.config.json names the module class")
    }

    @Test
    fun the_seam_package_imports_no_platform_class() {
        val files = File(main, "seam").walkTopDown().filter { it.isFile && it.name.endsWith(".kt") }.toList()
        assertTrue(files.any { it.name == "PlaybackEngine.kt" }, "the seam package holds PlaybackEngine.kt")
        val prefixes = listOf("import android.", "import androidx.", "import expo.", "import okhttp3.", "import com.facebook.")
        val offenders = files.filter { file -> file.readLines().any { line -> prefixes.any { line.trimStart().startsWith(it) } } }
        assertEquals(emptyList<String>(), offenders.map { it.name }, "files under seam/ that import a platform class")
    }
}
