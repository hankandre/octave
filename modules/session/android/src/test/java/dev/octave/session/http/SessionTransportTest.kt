package dev.octave.session.http

import dev.octave.session.http.TransportTestSupport.DEVICE_ID
import dev.octave.session.http.TransportTestSupport.TOKEN
import dev.octave.session.http.TransportTestSupport.assertError
import dev.octave.session.http.TransportTestSupport.assertNoToken
import dev.octave.session.http.TransportTestSupport.json
import dev.octave.session.http.TransportTestSupport.passwordSignIn
import dev.octave.session.http.TransportTestSupport.sessionRequest
import dev.octave.session.http.TransportTestSupport.signIn
import dev.octave.session.http.TransportTestSupport.signInAnswer
import dev.octave.session.http.TransportTestSupport.tokenlessRequest
import dev.octave.session.http.TransportTestSupport.transport
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import mockwebserver3.SocketEffect
import okhttp3.Headers.Companion.headersOf
import okio.Buffer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.TimeUnit

// T3-05 item 1, the Kotlin half: SessionTransport sends sign-in, a session request and their answers through
// OctaveHttp's one client, as the seam table of docs/specs/T3-05.md says; and each refusal of a request map once
// (the named refusal tests are T3-16's).
class SessionTransportTest {
    private val server = PathServer()

    @AfterEach
    fun close() = server.close()

    @Test
    fun a_password_sign_in_sends_the_tokenless_header_and_returns_no_token() {
        server.answer("/Users/AuthenticateByName") { signInAnswer(name = "louise $TOKEN") }
        val result = passwordSignIn(server.origin)
        assertEquals(setOf("session", "userId", "userName", "serverId"), result.keys)
        assertTrue(Regex("^[0-9a-f]{32}$").matches(result["session"] as String), "an opaque session id")
        assertEquals("user-1", result["userId"])
        assertEquals("louise [redacted]", result["userName"], "the token is stripped from every field")
        assertEquals("server-1", result["serverId"])
        for (value in result.values) assertNoToken(value as String)

        val sent = server.requests.single()
        assertEquals("POST", sent.method)
        assertEquals("/Users/AuthenticateByName", sent.target)
        assertTrue(sent.headers["Authorization"]!!.endsWith(", Token=\"\""), "the sign-in carries an empty token")
        assertEquals("application/json", sent.headers["Accept"])
        assertTrue(sent.headers["Content-Type"]!!.startsWith("application/json"))
        val body = Json.parseToJsonElement(sent.body!!.utf8()).jsonObject
        assertEquals("louise", body["Username"]!!.jsonPrimitive.content)
        assertEquals("placeholder-pw", body["Pw"]!!.jsonPrimitive.content)
        SessionRegistry.close(SessionId.parse(result["session"] as String)!!)
    }

    @Test
    fun a_quick_connect_sign_in_sends_the_secret_and_leaves_out_missing_fields() {
        server.answer("/Users/AuthenticateWithQuickConnect") { json(200, """{"AccessToken":"qc-token","User":{"Id":"user-2"}}""") }
        val result = transport.signIn(
            mapOf("server" to server.origin, "deviceId" to DEVICE_ID, "kind" to "quick-connect", "secret" to "qc-secret", "timeoutMs" to 5_000.0),
        )
        assertEquals(setOf("session", "userId"), result.keys)
        val body = Json.parseToJsonElement(server.requests.single().body!!.utf8()).jsonObject
        assertEquals(setOf("Secret"), body.keys)
        assertEquals("qc-secret", body["Secret"]!!.jsonPrimitive.content)
        SessionRegistry.close(SessionId.parse(result["session"] as String)!!)
    }

    @Test
    fun a_sign_in_answer_without_a_token_or_a_user_is_unexpected_and_a_4xx_is_a_status() {
        for (answer in listOf("""{"User":{"Id":"u"}}""", """{"AccessToken":"","User":{"Id":"u"}}""", """{"AccessToken":"t","User":{}}""", "not json", "")) {
            server.answer("/Users/AuthenticateByName") { json(200, answer) }
            assertError("unexpected-response", passwordSignIn(server.origin))
        }
        server.answer("/Users/AuthenticateByName") { json(401, """{"Message":"$TOKEN"}""") }
        assertEquals(mapOf("error" to "status", "status" to 401), passwordSignIn(server.origin))
    }

    @Test
    fun a_session_request_carries_the_token_keeps_the_base_path_and_crosses_a_stripped_body() {
        val session = signIn(server, "${server.origin}/jf")
        server.answer("/jf/UserViews") { json(200, """{"Items":[{"Url":"/x?ApiKey=$TOKEN"}]}""") }
        val result = sessionRequest(session, "GET", "/UserViews", mapOf("query" to listOf(listOf("userId", "user-1"))))
        assertEquals(200, result["status"])
        assertEquals("""{"Items":[{"Url":"/x?ApiKey=[redacted]"}]}""", result["body"])
        val sent = server.requests.last()
        assertEquals("/jf/UserViews?userId=user-1", sent.target)
        assertTrue(!sent.headers["Authorization"]!!.endsWith(", Token=\"\""), "the session request carries a token")
        assertEquals(listOf("POST /jf/Users/AuthenticateByName", "GET /jf/UserViews"), server.paths())
        SessionRegistry.close(SessionId.parse(session)!!)
    }

    @Test
    fun a_4xx_or_5xx_is_a_response_and_an_empty_or_html_body_crosses_as_null() {
        val session = signIn(server)
        server.answer("/Items/a") { json(404, """{"Message":"not found"}""") }
        server.answer("/Items/b") { MockResponse.Builder().code(500).addHeader("Content-Type", "text/html").body("<html>oops</html>").build() }
        server.answer("/Items/c") { MockResponse(204) }
        for ((index, text) in listOf("oops", "{a:1}", "{'a':1}", "{} x", "[1,]", "NaN", "01", "{\"a\":tru}").withIndex()) {
            server.answer("/Items/bad$index") { json(200, text) }
        }
        assertEquals(mapOf("status" to 404, "body" to """{"Message":"not found"}"""), sessionRequest(session, "GET", "/Items/a"))
        assertEquals(mapOf("status" to 500, "body" to null), sessionRequest(session, "GET", "/Items/b"))
        assertEquals(mapOf("status" to 204, "body" to null), sessionRequest(session, "GET", "/Items/c"))
        for (index in 0..7) assertEquals(mapOf("status" to 200, "body" to null), sessionRequest(session, "GET", "/Items/bad$index"), "bad$index")
        SessionRegistry.close(SessionId.parse(session)!!)
    }

    @Test
    fun a_redirect_is_the_redirect_code_and_is_not_followed() {
        server.answer("/System/Info/Public") { MockResponse(302, headersOf("Location", "http://127.0.0.1:9/?api_key=x")) }
        assertError("redirect", tokenlessRequest(server.origin, "GET", "/System/Info/Public"))
        assertEquals(1, server.requests.size)
    }

    @Test
    fun a_body_over_32_mib_is_unexpected() {
        val session = signIn(server)
        val big = Buffer().apply { write(ByteArray((SessionTransport.MAX_BODY_BYTES + 1).toInt()) { ' '.code.toByte() }) }
        server.answer("/Items/big") { MockResponse.Builder().code(200).body(big.clone()).build() }
        assertError("unexpected-response", sessionRequest(session, "GET", "/Items/big"))
        SessionRegistry.close(SessionId.parse(session)!!)
    }

    @Test
    fun a_get_is_sent_once_more_after_a_failure_before_any_answer_and_a_post_is_not() {
        val session = signIn(server)
        var getAttempts = 0
        server.answer("/Items/flaky") {
            getAttempts += 1
            if (getAttempts == 1) MockResponse.Builder().onResponseStart(SocketEffect.CloseSocket()).build() else json(200, "{}")
        }
        assertEquals(mapOf("status" to 200, "body" to "{}"), sessionRequest(session, "GET", "/Items/flaky"))
        assertEquals(2, getAttempts, "the GET was sent twice")

        var postAttempts = 0
        server.answer("/Items/flaky-post") {
            postAttempts += 1
            MockResponse.Builder().onResponseStart(SocketEffect.CloseSocket()).build()
        }
        assertError("network", sessionRequest(session, "POST", "/Items/flaky-post", mapOf("body" to "{}")))
        assertEquals(1, postAttempts, "the POST was sent once")

        var thirdAttempts = 0
        server.answer("/Items/down") {
            thirdAttempts += 1
            MockResponse.Builder().onResponseStart(SocketEffect.CloseSocket()).build()
        }
        assertError("network", sessionRequest(session, "GET", "/Items/down"))
        assertEquals(2, thirdAttempts, "a GET is sent at most twice")
        SessionRegistry.close(SessionId.parse(session)!!)
    }

    @Test
    fun a_closed_port_is_network_and_a_stalled_answer_is_timeout() {
        val closed = ServerSocket(0, 1, InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1))).use { it.localPort }
        assertError("network", tokenlessRequest("http://127.0.0.1:$closed", "GET", "/System/Info/Public"))
        server.answer("/System/Info/Public") { MockResponse.Builder().headersDelay(5, TimeUnit.SECONDS).body("{}").build() }
        val started = System.nanoTime()
        assertError("timeout", tokenlessRequest(server.origin, "GET", "/System/Info/Public", mapOf("timeoutMs" to 300)))
        assertTrue(System.nanoTime() - started < TimeUnit.SECONDS.toNanos(4), "the deadline held")
    }

    @Test
    fun each_refused_shape_is_refused_and_sends_nothing() {
        val session = signIn(server)
        server.requests.clear()
        val refusedRequests = listOf(
            mapOf("headers" to mapOf("X" to "1")),
            mapOf("url" to "http://127.0.0.1:9/"),
            mapOf("path" to "http://127.0.0.1:9/Items"),
            mapOf("path" to "//127.0.0.1:9/Items"),
            mapOf("path" to "Items"),
            mapOf("path" to "/Items?x=1"),
            mapOf("path" to "/Items#x"),
            mapOf("method" to "PUT"),
            mapOf("timeoutMs" to 0),
            mapOf("timeoutMs" to -1),
            mapOf("timeoutMs" to 1.5),
            mapOf("timeoutMs" to "1000"),
            mapOf("query" to listOf(listOf("api_key", "x"))),
            mapOf("query" to listOf(listOf(" ApiKey ", "x"))),
            mapOf("query" to listOf(listOf("only-a-name"))),
            mapOf("query" to "Fields=x"),
            mapOf("body" to "{}"),
            mapOf("server" to server.origin),
        )
        for (extra in refusedRequests) {
            assertError("refused", sessionRequest(session, "GET", "/Items", extra))
        }
        assertError("refused", sessionRequest(session, "POST", "/Items", mapOf("body" to "not json")))
        assertError("refused", sessionRequest("not-a-session", "GET", "/Items"))
        assertError("refused", sessionRequest("0".repeat(32), "GET", "/Items"))
        assertError("refused", sessionRequest(session, "GET", "/Items/$TOKEN"))
        assertEquals(emptyList<String>(), server.paths(), "nothing was sent")
        SessionRegistry.close(SessionId.parse(session)!!)
    }

    @Test
    fun a_sign_in_with_an_unknown_key_or_kind_or_a_public_plain_http_server_is_refused() {
        val base = mapOf("server" to server.origin, "deviceId" to DEVICE_ID, "kind" to "password", "username" to "u", "password" to "p", "timeoutMs" to 1_000)
        assertError("refused", transport.signIn(base + ("token" to "x")))
        assertError("refused", transport.signIn(base + ("secret" to "x")))
        assertError("refused", transport.signIn(base + ("kind" to "api-key")))
        assertError("refused", transport.signIn(base + ("server" to "http://203.0.113.7:8096")))
        assertError("refused", transport.signIn(base + ("server" to "http://user:pw@127.0.0.1:8096")))
        assertError("refused", transport.signIn(base - "password"))
        assertEquals(emptyList<String>(), server.paths(), "nothing was sent")
    }

    // Recorded, not asserted contained: the dot-segment refusal is T3-16's (backlog entry 172).
    @Test
    fun a_dot_segment_path_is_resolved_by_okhttp_and_reaches_the_server_as_recorded_here() {
        val session = signIn(server, "${server.origin}/jf")
        server.requests.clear()
        val result = sessionRequest(session, "GET", "/Items/../../x")
        assertEquals(404, result["status"])
        assertEquals(listOf("GET /x"), server.paths(), "OkHttp resolves the dot segments, leaving the base path")
        SessionRegistry.close(SessionId.parse(session)!!)
    }

    @Test
    fun a_null_value_counts_as_absent() {
        server.answer("/System/Info/Public") { json(200, """{"Version":"10.11.0"}""") }
        val result = tokenlessRequest(server.origin, "GET", "/System/Info/Public", mapOf("session" to null, "body" to null, "query" to null))
        assertEquals(200, result["status"])
        assertNull(server.requests.single().headers["Content-Type"])
    }
}
