package dev.octave.session.http

import dev.octave.session.http.TransportTestSupport.sessionRequest
import dev.octave.session.http.TransportTestSupport.signIn
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource

// T3-24 item 3 (docs/specs/T3-24.md, "The rule as built"): the UTF-8 check runs in every decoding round (P5), so an
// overlong form or an encoded surrogate that appears only after a decoding is refused, and a path that still holds a
// percent-escape after the fourth decoding is refused (P7). Each path runs on a session with the base path /jf and on
// one with none: the result is { error: "refused" } and the server records nothing after the sign-in. The near misses
// /Items/%25252541 (four decodings end in A) and /Items/100%25 (a decoded % that begins no escape is a literal) must
// reach the server. packages/core/src/adapters/request-path-forms.test.ts holds the same paths ("T3-24 item 3:").
class DecodingRoundsPathTest {
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
    fun a_path_not_utf8_in_a_later_round_or_still_encoded_after_four_is_refused(path: String, base: String) {
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
            "/Items/%25c0%25ae%25c0%25ae/x",
            "/Items/%2525c0%2525ae/x",
            "/Items/%25ed%25a0%2580",
            "/Items/%252525252e%252525252e/x",
            "/Items/%2525252541",
        )

        val ACCEPTED = listOf("/Items/%25252541", "/Items/100%25")

        @JvmStatic
        fun refusedCases(): List<Arguments> = REFUSED.flatMap { path -> BASES.map { Arguments.of(path, it) } }

        @JvmStatic
        fun acceptedCases(): List<Arguments> = ACCEPTED.flatMap { path -> BASES.map { Arguments.of(path, it) } }
    }
}
