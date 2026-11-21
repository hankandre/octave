package dev.octave.session.http

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

// T3-03: the session module has a name and no JavaScript surface until T3-05 (docs/specs/T3-03.md, "Shape"), and
// the HTTP package imports no Android class, so it runs on the JVM and Swift can mirror it.
class ModuleSurfaceTest {
    private val repoRoot = File(checkNotNull(System.getProperty("octave.repoRoot")) { "system property octave.repoRoot is not set" })
    private val main = File(repoRoot, "modules/session/android/src/main/java/dev/octave/session")

    @Test
    fun the_module_definition_is_a_name_and_nothing_else() {
        val source = File(main, "OctaveSessionModule.kt").readText()
        assertTrue(source.contains("Name(\"OctaveSession\")"), "the module is named OctaveSession")
        for (word in listOf("Function(", "AsyncFunction(", "Property(", "Constants(", "Constant(", "Events(", "Event(", "View(", "OnCreate", "OnDestroy", "Prop(")) {
            assertTrue(!source.contains(word), "the module definition holds $word")
        }
    }

    @Test
    fun the_module_config_names_the_module_class() {
        val config = File(repoRoot, "modules/session/expo-module.config.json").readText()
        assertTrue(config.contains("\"dev.octave.session.OctaveSessionModule\""), "expo-module.config.json names the module class")
        assertTrue(File(main, "OctaveSessionModule.kt").isFile, "the module class's file exists")
    }

    @Test
    fun the_http_package_imports_no_android_class() {
        val files = File(main, "http").walkTopDown().filter { it.isFile && it.name.endsWith(".kt") }.toList()
        val offenders = files.filter { file -> file.readLines().any { it.trimStart().startsWith("import android.") || it.trimStart().startsWith("import androidx.") } }
        assertEquals(emptyList<String>(), offenders.map { it.name }, "files under http/ that import an Android class")
    }
}
