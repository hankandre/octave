package dev.octave.session.http

import dev.octave.session.http.TestSupport.fetch
import dev.octave.session.http.TestSupport.get
import dev.octave.session.http.TestSupport.header
import dev.octave.session.http.TestSupport.refused
import dev.octave.session.http.TestSupport.withSession
import mockwebserver3.MockResponse
import okhttp3.Headers.Companion.headersOf
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

// T3-03 item 2: the interceptor adds the Authorization header only to requests whose scheme, host and port equal the
// signed-in server's; a request to any other origin fails before it is sent.
class OriginPinTest {
    private val servers = TwoServers()

    @AfterEach
    fun closeServers() = servers.close()

    @Test
    fun the_session_server_receives_the_exact_header_value() {
        withSession(servers.a.origin) { _, factory ->
            assertEquals(200, fetch(factory, servers.a.url("/Items?Fields=Path")))
        }
        val recorded = servers.a.requests.single()
        assertEquals(header(), recorded.headers["Authorization"], "the header server A received")
        assertEquals(1, recorded.headers.values("Authorization").size, "one Authorization header")
        servers.assertBReceivedNothing()
    }

    @Test
    fun request_refuses_headers_absolute_urls_and_other_origins() {
        val port = servers.a.port
        withSession(servers.a.origin) { _, factory ->
            // Other origins: another port, another spelling of the host, another scheme on the same host and port.
            for (url in listOf(servers.b.url("/Items"), "http://localhost:$port/Items", "https://127.0.0.1:$port/Items")) {
                refused(HttpRefusal.OTHER_ORIGIN) { fetch(factory, url) }
            }
            // A caller may not bring its own credential header, even to the session's origin.
            for ((name, value) in listOf("Authorization" to header(), "Proxy-Authorization" to "Basic dXNlcjpwdw==", "Cookie" to "session=1")) {
                refused(HttpRefusal.HEADER_NOT_ALLOWED) { fetch(factory, servers.a.url("/Items")) { addHeader(name, value) } }
            }
        }
        assertEquals(0, servers.a.requestCount, "server A's request count")
        assertEquals(0, servers.a.connections, "connections server A accepted")
        servers.assertBReceivedNothing()
    }

    @Test
    fun with_two_sessions_each_server_receives_only_its_own_header() {
        val headerA = header("CANARY-okhttp-7f3a-a")
        val headerB = header("CANARY-okhttp-7f3a-b")
        withSession(servers.a.origin, headerA) { _, factoryA ->
            withSession(servers.b.origin, headerB) { _, factoryB ->
                assertEquals(200, fetch(factoryA, servers.a.url("/Items")))
                assertEquals(200, fetch(factoryB, servers.b.url("/Items")))
                assertEquals(200, fetch(factoryA, servers.a.url("/Users")))
                refused(HttpRefusal.OTHER_ORIGIN) { fetch(factoryA, servers.b.url("/Items")) }
                refused(HttpRefusal.OTHER_ORIGIN) { fetch(factoryB, servers.a.url("/Items")) }
            }
        }
        assertEquals(listOf(headerA, headerA), servers.a.requests.map { it.headers["Authorization"] }, "server A's headers")
        assertEquals(listOf(headerB), servers.b.requests.map { it.headers["Authorization"] }, "server B's headers")
    }

    @Test
    fun the_answer_does_not_hand_back_the_header() {
        withSession(servers.a.origin) { _, factory ->
            get(factory, servers.a.url("/Items")).use { response ->
                assertEquals(200, response.code)
                assertEquals("from A", response.body.string())
                assertNull(response.request.header("Authorization"), "response.request holds no Authorization")
                assertNull(response.networkResponse, "networkResponse")
                assertNull(response.priorResponse, "priorResponse")
            }
        }
        assertEquals(header(), servers.a.requests.single().headers["Authorization"], "server A still received the header")
        servers.assertBReceivedNothing()
    }

    @Test
    fun the_answer_after_a_503_resend_does_not_hand_back_the_header() {
        servers.a.enqueue(MockResponse(503, headersOf("Retry-After", "0")))
        servers.a.enqueue(MockResponse(200, body = "after retry"))
        withSession(servers.a.origin) { _, factory ->
            get(factory, servers.a.url("/Items")).use { response ->
                assertEquals(200, response.code)
                assertEquals("after retry", response.body.string())
                assertNull(response.request.header("Authorization"), "response.request holds no Authorization")
                assertNull(response.networkResponse, "networkResponse")
                assertNull(response.priorResponse, "priorResponse")
            }
        }
        assertEquals(listOf(header(), header()), servers.a.requests.map { it.headers["Authorization"] }, "both requests server A received hold the header")
        servers.assertBReceivedNothing()
    }
}
