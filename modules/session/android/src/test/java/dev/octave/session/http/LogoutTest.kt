package dev.octave.session.http

import dev.octave.session.http.TransportTestSupport.assertError
import dev.octave.session.http.TransportTestSupport.json
import dev.octave.session.http.TransportTestSupport.sessionRequest
import dev.octave.session.http.TransportTestSupport.signIn
import dev.octave.session.http.TransportTestSupport.transport
import mockwebserver3.MockResponse
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// T3-05: endSession removes the registry entry first, then sends POST /Sessions/Logout with the removed session's
// header (decision 0005). The session is gone whatever the logout answers.
class LogoutTest {
    private val server = PathServer()

    @AfterEach
    fun close() = server.close()

    private fun end(session: String): Map<String, Any?> = transport.endSession(mapOf("session" to session, "timeoutMs" to 5_000.0))

    @Test
    fun logout_sends_the_session_s_token_under_its_base_path_and_ends_the_session() {
        val session = signIn(server, "${server.origin}/jf")
        val header = server.requests.single().headers["Authorization"]
        server.answer("/jf/Sessions/Logout") { MockResponse(204) }
        assertEquals(emptyMap<String, Any?>(), end(session))
        val logout = server.requests.last()
        assertEquals("POST /jf/Sessions/Logout", "${logout.method} ${logout.target}")
        assertTrue(logout.headers["Authorization"]!! != header && !logout.headers["Authorization"]!!.endsWith(", Token=\"\""), "the logout carries the token")
        assertNull(SessionRegistry.entry(SessionId.parse(session)!!))
        assertError("refused", sessionRequest(session, "GET", "/UserViews"))
        assertEquals(2, server.requests.size, "nothing was sent after the logout")
    }

    @Test
    fun a_failed_logout_is_a_status_and_the_session_is_still_gone() {
        val session = signIn(server)
        server.answer("/Sessions/Logout") { json(500, """{"Message":"oops"}""") }
        assertEquals(mapOf("error" to "status", "status" to 500), end(session))
        assertNull(SessionRegistry.entry(SessionId.parse(session)!!))
    }

    @Test
    fun an_unreachable_server_is_network_and_the_session_is_still_gone() {
        val session = signIn(server)
        server.close()
        assertError("network", end(session))
        assertNull(SessionRegistry.entry(SessionId.parse(session)!!))
    }

    @Test
    fun an_unknown_session_resolves_empty_and_a_malformed_one_is_refused() {
        assertEquals(emptyMap<String, Any?>(), end("0".repeat(32)))
        assertError("refused", end("not-a-session"))
        assertError("refused", transport.endSession(mapOf("session" to "0".repeat(32), "timeoutMs" to 1_000, "server" to server.origin)))
        assertEquals(0, server.requests.size)
    }

    @Test
    fun the_closing_authority_sends_only_the_logout() {
        val entry = SessionEntry("http", "127.0.0.1", 8096, TestSupport.authorization(), "/jf")
        fun check(method: String, url: String): HttpRefusal? {
            val body = if (method == "POST") ByteArray(0).toRequestBody(null) else null
            return RequestPolicy.checkClosing(entry, Request.Builder().url(url).method(method, body).build())
        }
        assertNull(check("POST", "http://127.0.0.1:8096/jf/Sessions/Logout"))
        assertEquals(HttpRefusal.ROUTE_NOT_ALLOWED, check("GET", "http://127.0.0.1:8096/jf/Sessions/Logout"))
        assertEquals(HttpRefusal.ROUTE_NOT_ALLOWED, check("POST", "http://127.0.0.1:8096/Sessions/Logout"))
        assertEquals(HttpRefusal.ROUTE_NOT_ALLOWED, check("GET", "http://127.0.0.1:8096/jf/Users/Me"))
        assertEquals(HttpRefusal.OTHER_ORIGIN, check("POST", "http://127.0.0.1:9/jf/Sessions/Logout"))
    }
}
