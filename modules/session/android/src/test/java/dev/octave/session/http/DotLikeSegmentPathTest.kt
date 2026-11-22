package dev.octave.session.http

import dev.octave.session.http.TransportTestSupport.sessionRequest
import dev.octave.session.http.TransportTestSupport.signIn
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource

// T3-24 item 2 (docs/specs/T3-24.md, "The dot-like characters"): the native request refuses a segment made only of
// dots and the nine dot-like characters, with at least one dot-like (P4), as written or after any round of
// percent-decoding. One case per listed character, escaped once and escaped twice, beside the spec's vectors; the raw
// forms are refused by C1 already and stay here so the list matches the core's. Each path runs on a session with the
// base path /jf and on one with none: the result is { error: "refused" } and the server records nothing after the
// sign-in. A dot-like character beside another character, and three ASCII dots, must reach the server.
// packages/core/src/adapters/request-path-forms.test.ts holds the same paths ("T3-24 item 2:").
class DotLikeSegmentPathTest {
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
    fun a_segment_of_dot_like_characters_is_refused_and_sends_nothing(path: String, base: String) {
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

        // The nine dot-like characters, by code point, with their UTF-8 escapes.
        private val DOT_LIKE = listOf(
            "․" to "%e2%80%a4",
            "‥" to "%e2%80%a5",
            "…" to "%e2%80%a6",
            "。" to "%e3%80%82",
            "︙" to "%ef%b8%99",
            "︰" to "%ef%b8%b0",
            "﹒" to "%ef%b9%92",
            "．" to "%ef%bc%8e",
            "｡" to "%ef%bd%a1",
        )

        val REFUSED = (
            listOf(
                "/Items/%ef%bc%8e%ef%bc%8e/x",
                "/Items/%EF%BC%8E/x",
                "/Items/.%ef%bc%8e/x",
                "/Items/%ef%bc%8e%ef%bc%8e%ef%bc%8e/x",
                "/Items/%25ef%25bc%258e%25ef%25bc%258e/x",
                "/Items/%e2%80%a4%e2%80%a4/x",
                "/Items/%e2%80%a5/x",
                "/Items/%e2%80%a6/x",
                "/Items/%e3%80%82%e3%80%82/x",
                "/Items/%ef%b8%99/x",
                "/Items/%ef%b8%b0/x",
                "/Items/%ef%b9%92%ef%b9%92/x",
                "/Items/%ef%bd%a1%ef%bd%a1/x",
                "/Items/．．/x",
            ) +
                DOT_LIKE.map { (_, escape) -> "/Items/$escape/x" } +
                DOT_LIKE.map { (_, escape) -> "/Items/${escape.replace("%", "%25")}/x" } +
                DOT_LIKE.map { (raw, _) -> "/Items/$raw/x" }
            ).distinct()

        val ACCEPTED = listOf("/Items/%EF%BC%8Ea", "/Items/a%E2%80%A6", "/Items/...")

        @JvmStatic
        fun refusedCases(): List<Arguments> = REFUSED.flatMap { path -> BASES.map { Arguments.of(path, it) } }

        @JvmStatic
        fun acceptedCases(): List<Arguments> = ACCEPTED.flatMap { path -> BASES.map { Arguments.of(path, it) } }
    }
}
