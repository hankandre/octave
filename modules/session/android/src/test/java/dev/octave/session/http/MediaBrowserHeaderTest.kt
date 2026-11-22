package dev.octave.session.http

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import java.io.File

// T3-03: the Kotlin header builder writes packages/core/tests/fixtures/authorization-header.json's values byte for
// byte (docs/security.md, kotlin_header_matches_the_recorded_vector), and parse accepts everything it builds.
class MediaBrowserHeaderTest {
    private val vectors = Json.parseToJsonElement(
        File(checkNotNull(System.getProperty("octave.repoRoot")), "packages/core/tests/fixtures/authorization-header.json").readText(),
    ).jsonObject["vectors"]!!.jsonArray.map { it.jsonObject }

    private fun built(vector: Map<String, kotlinx.serialization.json.JsonElement>): String {
        fun field(key: String) = vector[key]!!.jsonPrimitive.content
        return MediaBrowserHeader.build(field("client"), field("device"), field("deviceId"), field("version"), field("token"))
    }

    @Test
    fun kotlin_header_matches_the_recorded_vector() {
        val withToken = vectors.filter { it.containsKey("token") }
        assertEquals(4, withToken.size, "vectors with a token")
        for (vector in withToken) {
            assertEquals(vector["expected"]!!.jsonPrimitive.content, built(vector), vector["name"]!!.jsonPrimitive.content)
        }
    }

    @Test
    fun every_built_value_is_accepted() {
        for (vector in vectors.filter { it.containsKey("token") }) {
            assertNotNull(MediaBrowserAuthorization.parse(built(vector)), vector["name"]!!.jsonPrimitive.content)
        }
        assertNotNull(MediaBrowserAuthorization.parse(MediaBrowserHeader.build("", "", "", "", "t")), "empty fields with a token")
    }

    // T3-05: the tokenless header of the six pre-sign-in calls is the fixture's expectedWithoutToken, byte for byte.
    @Test
    fun the_tokenless_header_matches_the_recorded_vector() {
        assertEquals(5, vectors.size, "vectors")
        for (vector in vectors) {
            fun field(key: String) = vector[key]!!.jsonPrimitive.content
            assertEquals(
                field("expectedWithoutToken"),
                MediaBrowserHeader.buildTokenless(field("client"), field("device"), field("deviceId"), field("version")),
                field("name"),
            )
        }
    }

    @Test
    fun a_lone_surrogate_is_refused() {
        for (text in listOf("a\uD83Db", "a\uDE00b", "end\uD83D")) {
            assertThrows(IllegalArgumentException::class.java) { MediaBrowserHeader.build("Octave", text, "id", "1", "t") }
        }
    }
}
