package dev.octave.buildcheck

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.TimeUnit

// T3-19 decision log 27: the dex check (scripts/tv-apk-dex.mjs) cannot attribute an Octave reference to a class R8
// merged with others, so every class of its APK_NETWORK_ENTRY_POINTS rows and every ENTRY_POINT_HOOKS name must be
// refused here, before R8, by K7. The names are read from the dex check's own lists with Node, so a row the dex check
// adds cannot land without its refusal.
class NetworkPathRulesCoverageTest {
    private fun listedClasses(): List<String> {
        val lists = BuildCheck.repoRoot.resolve("scripts/tv-apk-dex-lists.mjs")
        val script = "const m = await import(process.argv[1]); " +
            "const names = [...m.APK_NETWORK_ENTRY_POINTS.flatMap((row) => row.classes), ...m.ENTRY_POINT_HOOKS]; " +
            "process.stdout.write(names.join('\\n'));"
        val process = ProcessBuilder("node", "--input-type=module", "-e", script, lists.toURI().toString())
            .redirectErrorStream(true)
            .start()
        val output = process.inputStream.bufferedReader().readText()
        assertTrue(process.waitFor(60, TimeUnit.SECONDS), "node did not finish reading ${lists.path}")
        assertEquals(0, process.exitValue(), "node could not read ${lists.path}: $output")
        return output.lines().filter { it.isNotBlank() }
    }

    @Test
    fun every_listed_class_and_hook_is_refused_by_k7() {
        val names = listedClasses()
        assertTrue(names.size >= 20, "read ${names.size} listed classes and hooks: $names")
        val uncovered = names.filter { name ->
            val slashed = name.replace('.', '/')
            val refs = ClassRefs("dev/octave/tv/Probe", setOf(slashed), emptyList(), setOf(slashed))
            NetworkPathRules.check(refs).none { it.rule == "K7" }
        }
        assertEquals(emptyList<String>(), uncovered, "add each to K7 in NetworkPathRules.kt")
    }
}
