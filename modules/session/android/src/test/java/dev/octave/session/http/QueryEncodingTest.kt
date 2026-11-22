package dev.octave.session.http

import dev.octave.session.http.TransportTestSupport.json
import dev.octave.session.http.TransportTestSupport.tokenlessRequest
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

// T3-05: the query is the reference adapter's, byte for byte (packages/core/tests/fixtures/transport-query-encoding.json,
// whose expected values the reference writes). On the wire OkHttp writes each ' in a query as %27 and changes nothing
// else; if it changes any other character this test fails, and the vectors are not edited.
class QueryEncodingTest {
    private val server = PathServer()

    @AfterEach
    fun close() = server.close()

    private val vectors = TestSupport.fixture("transport-query-encoding.json")["vectors"]!!.jsonArray.map { it.jsonObject }

    private fun pairs(vector: Map<String, kotlinx.serialization.json.JsonElement>): List<Pair<String, String>> =
        vector["query"]!!.jsonArray.map { pair -> pair.jsonArray[0].jsonPrimitive.content to pair.jsonArray[1].jsonPrimitive.content }

    @Test
    fun encode_writes_the_reference_query() {
        assertEquals(12, vectors.size, "vectors")
        for (vector in vectors) {
            assertEquals(vector["expected"]!!.jsonPrimitive.content, QueryEncoding.encode(pairs(vector)), vector["name"]!!.jsonPrimitive.content)
        }
        assertEquals(null, QueryEncoding.encode(emptyList()))
    }

    @Test
    fun the_server_receives_the_reference_query_with_each_apostrophe_as_percent_27() {
        server.answer("/System/Info/Public") { json(200, "{}") }
        for (vector in vectors) {
            val query = pairs(vector).map { (name, value) -> listOf(name, value) }
            assertEquals(200, tokenlessRequest(server.origin, "GET", "/System/Info/Public", mapOf("query" to query))["status"])
            val received = server.requests.last().target.substringAfter('?')
            assertEquals(vector["expected"]!!.jsonPrimitive.content.replace("'", "%27"), received, vector["name"]!!.jsonPrimitive.content)
        }
    }
}
