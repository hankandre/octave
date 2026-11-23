package dev.octave.preferences.store

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

// T9-02: the preferences module's JavaScript surface is two functions, read and write, with no event, property, constant
// or view. A new native method or event is an architecture change. The store package imports no Android class, so it
// runs on the JVM and Swift can mirror it.
class ModuleSurfaceTest {
    private val repoRoot = File(checkNotNull(System.getProperty("octave.repoRoot")) { "system property octave.repoRoot is not set" })
    private val main = File(repoRoot, "modules/preferences/android/src/main/java/dev/octave/preferences")

    // Code only: comments may name what the definition avoids.
    private val source: String
        get() = File(main, "OctavePreferencesModule.kt").readLines().joinToString("\n") { it.substringBefore("//") }

    @Test
    fun the_module_definition_is_a_name_and_two_functions() {
        assertTrue(source.contains("Name(\"OctavePreferences\")"), "the module is named OctavePreferences")
        assertEquals(emptyList<String>(), surfaceProblems(source))
    }

    @Test
    fun a_third_function_an_event_or_a_property_fails_the_scan() {
        for (extra in listOf("AsyncFunction(\"clear\") { }", "Function(\"get\") { }", "Events(\"changed\")", "Property(\"record\") { }", "Constants(\"record\" to 1)")) {
            val planted = source.replace("OnDestroy", "$extra\n        OnDestroy")
            assertTrue(planted != source, "the plant went in")
            assertTrue(surfaceProblems(planted).isNotEmpty(), "the scan sees $extra")
        }
    }

    private fun surfaceProblems(source: String): List<String> {
        val problems = mutableListOf<String>()
        val functions = Regex("""\b(?:Async)?Function\s*\(\s*"([^"]*)"""").findAll(source).map { it.groupValues[1] }.toList()
        if (functions != listOf("read", "write")) problems += "functions $functions"
        if (Regex("""\bAsyncFunction\s*\(""").findAll(source).count() != 2) problems += "a function that is not an AsyncFunction"
        for (word in listOf("Property(", "Constants(", "Constant(", "Events(", "Event(", "View(", "OnCreate", "Prop(", "sendEvent")) {
            if (source.contains(word)) problems += word
        }
        return problems
    }

    @Test
    fun the_module_config_names_the_module_class() {
        val config = File(repoRoot, "modules/preferences/expo-module.config.json").readText()
        assertTrue(config.contains("\"dev.octave.preferences.OctavePreferencesModule\""), "expo-module.config.json names the module class")
        assertTrue(File(main, "OctavePreferencesModule.kt").isFile, "the module class's file exists")
    }

    @Test
    fun the_store_package_imports_no_android_class() {
        val files = File(main, "store").walkTopDown().filter { it.isFile && it.name.endsWith(".kt") }.toList()
        assertTrue(files.isNotEmpty(), "the store package has sources")
        val offenders = files.filter { file -> file.readLines().any { it.trimStart().startsWith("import android.") || it.trimStart().startsWith("import androidx.") } }
        assertEquals(emptyList<String>(), offenders.map { it.name }, "files under store/ that import an Android class")
    }
}
