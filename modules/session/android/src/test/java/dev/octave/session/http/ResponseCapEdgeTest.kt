package dev.octave.session.http

import dev.octave.session.http.TransportTestSupport.DEVICE_ID
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

// T3-25 item 3 (docs/specs/T3-25.md, "Item 3, ResponseCapEdgeTest"): the three response-cap cases T3-16's review found
// untested. This file is in no manifest (security-doc-t3-25.test.ts checks that). The caps are hard-coded as in
// ResponseCapTest: tokenless and sign-in 1 MiB, a session's POST or DELETE 4 MiB, a session's GET 8 MiB.
//
// - A declared-length answer (Content-Length, not chunked) of exactly the cap crosses, per class.
// - A body of cap + 1 bytes that is not JSON is unexpected-response, declared and chunked, per class. Under the cap
//   such a body crosses as a status with no body, so only a refusal before the parse gives this result.
// - An oversized password or quick-connect sign-in answer leaves SessionRegistry with no new entry.
class ResponseCapEdgeTest {
    private val server = PathServer()

    @AfterEach
    fun close() = server.close()

    private fun jsonOf(bytes: Int, prefix: String = ""): String {
        val head = """{$prefix"Pad":""""
        val tail = """"}"""
        val text = head + "a".repeat(bytes - head.length - tail.length) + tail
        check(text.toByteArray(Charsets.UTF_8).size == bytes) { "the padded JSON has the wrong size" }
        return text
    }

    // `<` followed by `a` padding: not JSON, `bytes` bytes.
    private fun notJsonOf(bytes: Int): String = "<" + "a".repeat(bytes - 1)

    private fun declared(code: Int, text: String): MockResponse {
        val response = MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(Buffer().writeUtf8(text)).build()
        check(response.headers["Content-Length"] == text.length.toString()) { "the answer does not declare its length" }
        return response
    }

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

    private fun quickConnectSignIn(): Map<String, Any?> = transport.signIn(
        mapOf("server" to server.origin, "deviceId" to DEVICE_ID, "kind" to "quick-connect", "secret" to "qc-secret", "timeoutMs" to 5_000.0),
    )

    @Test
    fun a_declared_length_answer_of_exactly_the_cap_crosses() {
        val tokenless = jsonOf(TOKENLESS_CAP)
        server.answer("/System/Info/Public") { declared(200, tokenless) }
        assertEquals(mapOf("status" to 200, "body" to tokenless), tokenlessRequest(server.origin, "GET", "/System/Info/Public"), "tokenless GET, 1 MiB")

        withSession { session ->
            val write = jsonOf(WRITE_CAP)
            server.answer("/Items/a/PlaybackInfo") { declared(200, write) }
            assertEquals(
                mapOf("status" to 200, "body" to write),
                sessionRequest(session, "POST", "/Items/a/PlaybackInfo", mapOf("body" to "{}")),
                "session POST, 4 MiB",
            )
            val read = jsonOf(READ_CAP)
            server.answer("/Items") { declared(200, read) }
            assertEquals(mapOf("status" to 200, "body" to read), sessionRequest(session, "GET", "/Items"), "session GET, 8 MiB")
        }

        server.answer("/Users/AuthenticateByName") { declared(200, jsonOf(TOKENLESS_CAP, SIGN_IN_PREFIX)) }
        val before = SessionRegistry.count()
        val result = passwordSignIn(server.origin)
        val session = result["session"] as? String
        try {
            assertTrue(session != null, "a declared sign-in answer of exactly 1 MiB opens a session (result keys ${result.keys})")
            assertEquals(before + 1, SessionRegistry.count(), "one new entry")
        } finally {
            session?.let { SessionId.parse(it) }?.let { SessionRegistry.close(it) }
        }
    }

    @Test
    fun an_oversized_body_that_is_not_json_is_unexpected() {
        // Control: under the cap, a body that is not JSON crosses as a status with no body.
        server.answer("/System/Info/Public") { declared(200, notJsonOf(1024)) }
        assertEquals(mapOf("status" to 200, "body" to null), tokenlessRequest(server.origin, "GET", "/System/Info/Public"), "not JSON under the cap")

        val tokenless = notJsonOf(TOKENLESS_CAP + 1)
        for ((form, answer) in listOf("declared" to declared(200, tokenless), "chunked" to chunked(200, tokenless))) {
            server.answer("/System/Info/Public") { answer }
            assertEquals(mapOf("error" to "unexpected-response"), tokenlessRequest(server.origin, "GET", "/System/Info/Public"), "$form: tokenless GET")
        }
        withSession { session ->
            val write = notJsonOf(WRITE_CAP + 1)
            for ((form, answer) in listOf("declared" to declared(200, write), "chunked" to chunked(200, write))) {
                server.answer("/Items/a/PlaybackInfo") { answer }
                assertEquals(
                    mapOf("error" to "unexpected-response"),
                    sessionRequest(session, "POST", "/Items/a/PlaybackInfo", mapOf("body" to "{}")),
                    "$form: session POST",
                )
            }
            val read = notJsonOf(READ_CAP + 1)
            for ((form, answer) in listOf("declared" to declared(200, read), "chunked" to chunked(200, read))) {
                server.answer("/Items") { answer }
                assertEquals(mapOf("error" to "unexpected-response"), sessionRequest(session, "GET", "/Items"), "$form: session GET")
            }
        }
    }

    @Test
    fun an_oversized_sign_in_answer_leaves_the_registry_with_no_new_entry() {
        // Control: a sign-in answer under the cap raises the count by one.
        server.answer("/Users/AuthenticateByName") { declared(200, jsonOf(4096, SIGN_IN_PREFIX)) }
        val start = SessionRegistry.count()
        val opened = passwordSignIn(server.origin)
        val session = opened["session"] as? String
        try {
            assertTrue(session != null, "a sign-in under the cap opens a session (result keys ${opened.keys})")
            assertEquals(start + 1, SessionRegistry.count(), "the control opens one entry")
        } finally {
            session?.let { SessionId.parse(it) }?.let { SessionRegistry.close(it) }
        }

        val over = jsonOf(TOKENLESS_CAP + 1, SIGN_IN_PREFIX)
        for ((form, answer) in listOf("declared" to declared(200, over), "chunked" to chunked(200, over))) {
            server.answer("/Users/AuthenticateByName") { answer }
            val before = SessionRegistry.count()
            assertEquals(mapOf("error" to "unexpected-response"), passwordSignIn(server.origin), "$form: password sign-in")
            assertEquals(before, SessionRegistry.count(), "$form: password sign-in adds no entry")

            server.answer("/Users/AuthenticateWithQuickConnect") { answer }
            val beforeQuickConnect = SessionRegistry.count()
            assertEquals(mapOf("error" to "unexpected-response"), quickConnectSignIn(), "$form: quick-connect sign-in")
            assertEquals(beforeQuickConnect, SessionRegistry.count(), "$form: quick-connect sign-in adds no entry")
        }
    }

    private companion object {
        const val MIB = 1024 * 1024
        const val TOKENLESS_CAP = 1 * MIB
        const val WRITE_CAP = 4 * MIB
        const val READ_CAP = 8 * MIB
        const val SIGN_IN_PREFIX = """"AccessToken":"edge-token","User":{"Id":"user-1","Name":"louise"},"ServerId":"server-1","""
    }
}
