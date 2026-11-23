package dev.octave.session.http

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import okio.Buffer
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// T3-11 acceptance item 3 (docs/specs/T3-11.md, "The fetch"; spec check issues 2 and 3): every vector of
// packages/core/tests/fixtures/image-requests.json through ArtworkRequest.cappedWidth and ArtworkFetch.prepare against a
// MockWebServer session.
//
// The contract frozen here (the session module's HTTP package, public, Kotlin only):
// - ArtworkRequest(itemId: String, type: String, tag: String, width: Int).
// - ArtworkRequest.cappedWidth(type: String, width: Int): Int?, a companion function and the one place the cap is
//   computed (the artwork module's cache key uses it too): null for a type outside Primary, Backdrop, Thumb and Logo or
//   a width below 1; otherwise min(width, 400) for Primary and min(width, 1920) for the other three. A width below 1 is
//   refused, a width above the cap is capped.
// - ArtworkFetch.prepare(session, request): PreparedArtwork?, null and nothing sent when the vector says refused;
//   otherwise one GET of the vector's path with exactly the vector's query pairs, in order: tag, maxWidth (the capped
//   width), quality=90, format=Webp.
// - PreparedArtwork.execute(timeoutMs): ArtworkAnswer; a 2xx answer is ArtworkAnswer.Bytes holding the body.
class ArtworkRequestVectorsTest {
    private val body = byteArrayOf(0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03, 0x04)

    private fun vectors(): List<JsonObject> =
        TestSupport.fixture("image-requests.json")["vectors"]!!.jsonArray.map { it.jsonObject }

    private fun requestOf(vector: JsonObject): ArtworkRequest {
        val request = vector["request"]!!.jsonObject
        return ArtworkRequest(
            request["itemId"]!!.jsonPrimitive.content,
            request["type"]!!.jsonPrimitive.content,
            request["tag"]!!.jsonPrimitive.content,
            request["width"]!!.jsonPrimitive.int,
        )
    }

    private fun answer(): MockResponse =
        MockResponse.Builder().code(200).addHeader("Content-Type", "image/webp").body(Buffer().write(body)).build()

    @Test
    fun the_vector_file_covers_the_widths_the_spec_names() {
        val vectors = vectors()
        assertTrue(vectors.size >= 20, "about 20 vectors")
        val widths = vectors.map { it["request"]!!.jsonObject["width"]!!.jsonPrimitive.int }.toSet()
        for (width in listOf(248, 416, 400, 600, 1, 1920, 1921, 4000, 0)) assertTrue(width in widths, "a vector with width $width")
        assertTrue(widths.any { it < 0 }, "a vector with a negative width")
    }

    @Test
    fun capped_width_answers_each_vector() {
        for (vector in vectors()) {
            val name = vector["name"]!!.jsonPrimitive.content
            val request = vector["request"]!!.jsonObject
            val expected = vector["cappedWidth"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.intOrNull }
            val actual = ArtworkRequest.cappedWidth(request["type"]!!.jsonPrimitive.content, request["width"]!!.jsonPrimitive.int)
            assertEquals(expected, actual, name)
        }
    }

    @Test
    fun capped_width_holds_the_cap_per_type() {
        assertEquals(248, ArtworkRequest.cappedWidth("Primary", 248))
        assertEquals(400, ArtworkRequest.cappedWidth("Primary", 401))
        assertEquals(400, ArtworkRequest.cappedWidth("Primary", Int.MAX_VALUE))
        for (type in listOf("Backdrop", "Thumb", "Logo")) {
            assertEquals(1920, ArtworkRequest.cappedWidth(type, 1921), type)
            assertEquals(416, ArtworkRequest.cappedWidth(type, 416), type)
        }
        assertNull(ArtworkRequest.cappedWidth("Primary", 0))
        assertNull(ArtworkRequest.cappedWidth("Primary", Int.MIN_VALUE))
        assertNull(ArtworkRequest.cappedWidth("Chapter", 248))
        assertNull(ArtworkRequest.cappedWidth("", 248))
    }

    @Test
    fun prepare_sends_each_vector_as_written_or_refuses_it_and_sends_nothing() {
        for (vector in vectors()) {
            val name = vector["name"]!!.jsonPrimitive.content
            val server = TestServer(answer())
            server.start()
            try {
                TestSupport.withSession(server.origin) { session, _ ->
                    val prepared = ArtworkFetch.prepare(session, requestOf(vector))
                    val expected = vector["expected"]!!
                    if (expected is JsonNull) {
                        assertNull(prepared, "$name: refused")
                        assertEquals(0, server.requestCount, "$name: nothing was sent")
                        assertEquals(0, server.connections, "$name: no connection was opened")
                    } else {
                        assertNotNull(prepared, "$name: prepared")
                        val result = prepared!!.execute(5_000)
                        assertTrue(result is ArtworkAnswer.Bytes, "$name: a 2xx answer is Bytes")
                        assertTrue(body.contentEquals((result as ArtworkAnswer.Bytes).bytes), "$name: the bytes are the body")
                        assertEquals(1, server.requestCount, "$name: one request")
                        val recorded = server.requests.single()
                        assertEquals("GET", recorded.method, name)
                        val path = expected.jsonObject["path"]!!.jsonPrimitive.content
                        val query = (expected.jsonObject["query"] as JsonArray).joinToString("&") { pair ->
                            val (key, value) = pair.jsonArray.map { it.jsonPrimitive.content }
                            "$key=$value"
                        }
                        assertEquals("$path?$query", recorded.target, "$name: the request target")
                    }
                }
            } finally {
                server.close()
            }
        }
    }
}
