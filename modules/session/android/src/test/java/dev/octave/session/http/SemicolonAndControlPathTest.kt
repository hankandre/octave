package dev.octave.session.http

import dev.octave.session.http.TransportTestSupport.sessionRequest
import dev.octave.session.http.TransportTestSupport.signIn
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource

// T3-24 item 1 (docs/specs/T3-24.md, "The rule as built"): the native request refuses a path that holds a ; (P6) or a
// control character, U+0000 to U+001F or U+007F to U+009F (P3), as written or after any round of percent-decoding,
// before anything is sent. Each path runs on a session with the base path /jf and on one with none: the result is
// { error: "refused" } and the server records nothing after the sign-in. The near miss /Items/a%3Ab must reach the
// server, so a rule that refuses every escape fails. packages/core/src/adapters/request-path-forms.test.ts holds the
// same paths for the core's mirror ("T3-24 item 1:").
class SemicolonAndControlPathTest {
    private val server = PathServer()

    @AfterEach
    fun close() = server.close()

    // Signs in on `base`, clears the record, sends `path`, and closes the session.
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
    fun a_semicolon_or_control_character_in_any_round_is_refused_and_sends_nothing(path: String, base: String) {
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

    companion object {
        private val BASES = listOf("/jf", "")

        val REFUSED = listOf(
            "/Items/..;/x",
            "/Items/%2e%2e;/x",
            "/Items/..%3b/x",
            "/Items/..%253b/x",
            "/Items/a;b",
            "/Items/a;v=1/x",
            "/Items/..%00/x",
            "/Items/a%00b",
            "/Items/a%2500b",
            "/Items/a%0ab",
            "/Items/a%7fb",
            "/Items/a%c2%85b",
            "/Items/a\u0085b",
            "/Items/a\u009fb",
        )

        val ACCEPTED = listOf("/Items/a%3Ab")

        @JvmStatic
        fun refusedCases(): List<Arguments> = REFUSED.flatMap { path -> BASES.map { Arguments.of(path, it) } }

        @JvmStatic
        fun acceptedCases(): List<Arguments> = ACCEPTED.flatMap { path -> BASES.map { Arguments.of(path, it) } }
    }
}
