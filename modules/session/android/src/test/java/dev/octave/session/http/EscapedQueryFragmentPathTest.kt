package dev.octave.session.http

import dev.octave.session.http.TransportTestSupport.sessionRequest
import dev.octave.session.http.TransportTestSupport.signIn
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource

// T3-24 review fix (docs/specs/T3-24.md, "The rule as built", P1): no decoding round may hold a ? or #. A proxy that
// decodes the path once and then splits off a query or fragment would read /jf/Items/..%3f/x as the path /jf/Items/..,
// which climbs out of the base path. The native request refuses each form on both base paths and sends nothing, and
// the one client (C2) refuses the same encoded paths through OctaveHttp.callFactory. Each C2 case first asserts that
// OkHttp keeps the encoded path as written, so the base-path prefix alone would pass it. The core's mirror holds the
// same paths (packages/core/src/adapters/request-path-query-fragment.test.ts).
class EscapedQueryFragmentPathTest {
    private val server = PathServer()

    @AfterEach
    fun close() = server.close()

    private fun send(base: String, path: String): Map<String, Any?> {
        val session = signIn(server, server.origin + base)
        server.requests.clear()
        try {
            return sessionRequest(session, "GET", path)
        } finally {
            SessionRegistry.close(SessionId.parse(session)!!)
        }
    }

    @ParameterizedTest(name = "refused {0} on base path {1}")
    @MethodSource("refusedCases")
    fun an_escaped_question_mark_or_hash_in_any_round_is_refused_and_sends_nothing(path: String, base: String) {
        val result = send(base, path)
        val sent = server.requests.map { it.target }
        assertEquals(mapOf("error" to "refused"), result, "$path: result (the server received $sent)")
        assertEquals(emptyList<String>(), sent, "$path: nothing was sent")
    }

    @ParameterizedTest(name = "sent {0} on base path {1}")
    @MethodSource("acceptedCases")
    fun a_near_miss_reaches_the_server(path: String, base: String) {
        val result = send(base, path)
        assertEquals(404, result["status"], "$path: the request was sent and answered (result $result)")
        assertEquals(listOf(base + path), server.requests.map { it.target }, "$path: the target sent")
    }

    @ParameterizedTest(name = "one client refuses {0}")
    @MethodSource("clientCases")
    fun the_one_client_refuses_an_encoded_path_with_an_escaped_question_mark_or_hash(path: String) {
        val target = "/jf$path"
        val url = server.origin + target
        assertEquals(target, url.toHttpUrl().encodedPath, "$target: OkHttp keeps the encoded path as written")
        TestSupport.withSession("${server.origin}/jf") { _, factory ->
            val error = assertThrows(OctaveHttpException::class.java, {
                factory.newCall(Request.Builder().url(url).build()).execute().close()
            }, "$target is refused")
            assertEquals("outside-base-path", error.refusal.code, "$target: refusal code")
        }
        assertEquals(emptyList<String>(), server.requests.map { it.target }, "$target: nothing was sent")
    }

    companion object {
        private val BASES = listOf("/jf", "")

        val REFUSED = listOf(
            "/Items/..%3f/x",
            "/Items/..%3F/x",
            "/Items/..%23/x",
            "/Items/..%253f/x",
            "/Items/..%25253F/x",
            "/Items/%2e%2e%3f",
            "/Items/%2e%2e%23x",
            "/Items/a%3fb",
            "/Items/a%23b",
        )

        val ACCEPTED = listOf("/Items/a%3Ab", "/Items/100%25", "/Items/3f/23")

        @JvmStatic
        fun refusedCases(): List<Arguments> = REFUSED.flatMap { path -> BASES.map { Arguments.of(path, it) } }

        @JvmStatic
        fun acceptedCases(): List<Arguments> = ACCEPTED.flatMap { path -> BASES.map { Arguments.of(path, it) } }

        @JvmStatic
        fun clientCases(): List<Arguments> = REFUSED.map { Arguments.of(it) }
    }
}
