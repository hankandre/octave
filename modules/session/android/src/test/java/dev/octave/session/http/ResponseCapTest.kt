package dev.octave.session.http

import dev.octave.session.http.TransportTestSupport.DEVICE_ID
import dev.octave.session.http.TransportTestSupport.assertError
import dev.octave.session.http.TransportTestSupport.passwordSignIn
import dev.octave.session.http.TransportTestSupport.sessionRequest
import dev.octave.session.http.TransportTestSupport.signIn
import dev.octave.session.http.TransportTestSupport.tokenlessRequest
import dev.octave.session.http.TransportTestSupport.transport
import mockwebserver3.MockResponse
import okio.Buffer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// T3-16 item 8 (docs/specs/T3-16.md, "The answer caps"): an answer larger than the cap of its endpoint class is
// refused with unexpected-response before it is parsed. The caps are hard-coded from the spec's table, so this file
// names no constant:
//
//   tokenless (the four pre-sign-in routes and the two sign-in posts)  1 MiB
//   session write (a session's POST and DELETE)                        4 MiB
//   session read (a session's GET)                                     8 MiB
//
// Per class: valid JSON of cap + 1 bytes with status 200, once with a declared Content-Length and once chunked, is
// unexpected-response; a body of exactly the cap crosses. A 4xx or 5xx answer has the same cap.
class ResponseCapTest {
    private val server = PathServer()

    @AfterEach
    fun close() = server.close()

    // A JSON object of exactly `bytes` bytes, padded in one string field after `prefix` (which ends with a comma or is
    // empty, and is ASCII).
    private fun jsonOf(bytes: Int, prefix: String = ""): String {
        val head = """{$prefix"Pad":""""
        val tail = """"}"""
        val text = head + "a".repeat(bytes - head.length - tail.length) + tail
        check(text.toByteArray(Charsets.UTF_8).size == bytes) { "the padded JSON has the wrong size" }
        return text
    }

    private fun declared(code: Int, text: String): MockResponse =
        MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(Buffer().writeUtf8(text)).build()

    private fun chunked(code: Int, text: String): MockResponse =
        MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").chunkedBody(Buffer().writeUtf8(text), 64 * 1024).build()

    private fun withSession(block: (String) -> Unit) {
        val session = signIn(server)
        try {
            block(session)
        } finally {
            SessionRegistry.close(SessionId.parse(session)!!)
        }
    }

    @Test
    fun a_tokenless_answer_over_1_mib_is_unexpected() {
        val over = jsonOf(TOKENLESS_CAP + 1)
        for ((form, answer) in listOf("declared" to declared(200, over), "chunked" to chunked(200, over))) {
            server.answer("/System/Info/Public") { answer }
            assertError("unexpected-response", tokenlessRequest(server.origin, "GET", "/System/Info/Public"))
            server.answer("/QuickConnect/Initiate") { answer }
            assertEquals(mapOf("error" to "unexpected-response"), tokenlessRequest(server.origin, "POST", "/QuickConnect/Initiate"), "$form: POST")
        }
        val exact = jsonOf(TOKENLESS_CAP)
        server.answer("/System/Info/Public") { chunked(200, exact) }
        assertEquals(mapOf("status" to 200, "body" to exact), tokenlessRequest(server.origin, "GET", "/System/Info/Public"), "exactly the cap crosses")
    }

    @Test
    fun a_sign_in_answer_over_1_mib_is_unexpected_and_opens_no_session() {
        val prefix = """"AccessToken":"cap-token","User":{"Id":"user-1","Name":"louise"},"ServerId":"server-1","""
        val over = jsonOf(TOKENLESS_CAP + 1, prefix)
        for ((form, answer) in listOf("declared" to declared(200, over), "chunked" to chunked(200, over))) {
            server.answer("/Users/AuthenticateByName") { answer }
            assertEquals(mapOf("error" to "unexpected-response"), passwordSignIn(server.origin), "$form: password sign-in")
            server.answer("/Users/AuthenticateWithQuickConnect") { answer }
            val quickConnect = transport.signIn(
                mapOf("server" to server.origin, "deviceId" to DEVICE_ID, "kind" to "quick-connect", "secret" to "qc-secret", "timeoutMs" to 5_000.0),
            )
            assertEquals(mapOf("error" to "unexpected-response"), quickConnect, "$form: quick-connect sign-in")
        }
        server.answer("/Users/AuthenticateByName") { chunked(200, jsonOf(TOKENLESS_CAP, prefix)) }
        val result = passwordSignIn(server.origin)
        val session = result["session"] as? String
        assertTrue(session != null, "a sign-in answer of exactly the cap opens a session (result keys ${result.keys})")
        SessionRegistry.close(SessionId.parse(session!!)!!)
    }

    @Test
    fun a_session_write_answer_over_4_mib_is_unexpected() = withSession { session ->
        val over = jsonOf(WRITE_CAP + 1)
        for ((form, answer) in listOf("declared" to declared(200, over), "chunked" to chunked(200, over))) {
            server.answer("/Items/a/PlaybackInfo") { answer }
            assertEquals(mapOf("error" to "unexpected-response"), sessionRequest(session, "POST", "/Items/a/PlaybackInfo", mapOf("body" to "{}")), "$form: POST")
            server.answer("/Videos/ActiveEncodings") { answer }
            assertEquals(mapOf("error" to "unexpected-response"), sessionRequest(session, "DELETE", "/Videos/ActiveEncodings"), "$form: DELETE")
        }
        val exact = jsonOf(WRITE_CAP)
        server.answer("/Items/a/PlaybackInfo") { chunked(200, exact) }
        assertEquals(mapOf("status" to 200, "body" to exact), sessionRequest(session, "POST", "/Items/a/PlaybackInfo", mapOf("body" to "{}")), "exactly the cap crosses")
    }

    @Test
    fun a_session_read_answer_over_8_mib_is_unexpected() = withSession { session ->
        val over = jsonOf(READ_CAP + 1)
        for ((form, answer) in listOf("declared" to declared(200, over), "chunked" to chunked(200, over))) {
            server.answer("/Items") { answer }
            assertEquals(mapOf("error" to "unexpected-response"), sessionRequest(session, "GET", "/Items"), "$form: GET")
        }
        val exact = jsonOf(READ_CAP)
        server.answer("/Items") { chunked(200, exact) }
        assertEquals(mapOf("status" to 200, "body" to exact), sessionRequest(session, "GET", "/Items"), "exactly the cap crosses")
    }

    @Test
    fun an_error_answer_has_the_same_cap() = withSession { session ->
        for (code in listOf(404, 500)) {
            server.answer("/Items") { declared(code, jsonOf(READ_CAP + 1)) }
            assertEquals(mapOf("error" to "unexpected-response"), sessionRequest(session, "GET", "/Items"), "$code GET over 8 MiB")
            server.answer("/Items/a/PlaybackInfo") { chunked(code, jsonOf(WRITE_CAP + 1)) }
            assertEquals(mapOf("error" to "unexpected-response"), sessionRequest(session, "POST", "/Items/a/PlaybackInfo", mapOf("body" to "{}")), "$code POST over 4 MiB")
        }
        server.answer("/System/Info/Public") { declared(503, jsonOf(TOKENLESS_CAP + 1)) }
        assertEquals(mapOf("error" to "unexpected-response"), tokenlessRequest(server.origin, "GET", "/System/Info/Public"), "503 tokenless over 1 MiB")
    }

    private companion object {
        const val MIB = 1024 * 1024
        const val TOKENLESS_CAP = 1 * MIB
        const val WRITE_CAP = 4 * MIB
        const val READ_CAP = 8 * MIB
    }
}
