package dev.octave.session.http

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.opentest4j.AssertionFailedError
import java.io.File

// T3-16 item 3 (gate: met; docs/specs/T3-16.md, "Named pins"): the control for kotlin_header_matches_the_recorded_vector
// (MediaBrowserHeaderTest). The comparison is byte for byte, so a changed quote or encoding fails it: for every vector
// with a token, the Kotlin value differs from the recorded value with `"` changed to `'`, with one %XX in the other hex
// case (where the vector has one with a letter), and with %20 changed to + (where the vector has one).
class HeaderVectorControlTest {
    private val vectors = Json.parseToJsonElement(
        File(checkNotNull(System.getProperty("octave.repoRoot")), "packages/core/tests/fixtures/authorization-header.json").readText(),
    ).jsonObject["vectors"]!!.jsonArray.map { it.jsonObject }

    private fun field(vector: Map<String, JsonElement>, key: String) = vector[key]!!.jsonPrimitive.content

    private fun built(vector: Map<String, JsonElement>): String =
        MediaBrowserHeader.build(field(vector, "client"), field(vector, "device"), field(vector, "deviceId"), field(vector, "version"), field(vector, "token"))

    private val hexWithLetter = Regex("%(?:[0-9A-Fa-f][A-Fa-f]|[A-Fa-f][0-9A-Fa-f])")

    private fun otherHexCase(text: String): String? {
        val match = hexWithLetter.find(text) ?: return null
        val swapped = match.value.map { if (it.isUpperCase()) it.lowercaseChar() else it.uppercaseChar() }.joinToString("")
        return text.replaceRange(match.range, swapped)
    }

    @Test
    fun a_changed_quote_or_encoding_does_not_match() {
        val withToken = vectors.filter { it.containsKey("token") }
        assertEquals(4, withToken.size, "vectors with a token")
        val applied = mutableMapOf("quote" to 0, "hex case" to 0, "space" to 0)
        for (vector in withToken) {
            val name = field(vector, "name")
            val expected = field(vector, "expected")
            val value = built(vector)
            assertEquals(expected, value, "$name: the unchanged vector matches")
            val changed = listOfNotNull(
                "quote" to expected.replace('"', '\''),
                otherHexCase(expected)?.let { "hex case" to it },
                expected.takeIf { it.contains("%20") }?.let { "space" to it.replaceFirst("%20", "+") },
            )
            for ((kind, text) in changed) {
                assertNotEquals(expected, text, "$name: the $kind change changes the recorded value")
                assertNotEquals(text, value, "$name: the Kotlin value does not match the value with a changed $kind")
                assertThrows(AssertionFailedError::class.java, { assertEquals(text, value) }, "$name: the vector test's comparison fails on a changed $kind")
                applied[kind] = applied.getValue(kind) + 1
            }
        }
        for ((kind, count) in applied) assertTrue(count > 0, "the $kind change applied to at least one vector")
    }
}
