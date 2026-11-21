package dev.octave.session.http

import dev.octave.session.http.TestSupport.authorization
import dev.octave.session.http.TestSupport.fetch
import dev.octave.session.http.TestSupport.get
import dev.octave.session.http.TestSupport.header
import dev.octave.session.http.TestSupport.proxyProperties
import dev.octave.session.http.TestSupport.refused
import dev.octave.session.http.TestSupport.withSession
import dev.octave.session.http.TestSupport.withSystemProperties
import mockwebserver3.MockResponse
import okhttp3.Headers.Companion.headersOf
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// T3-03 item 8: MockWebServer tests cover each rule of items 2 to 7, with server A as the session's server and
// server B standing in for the other origin; every test ends with B having received nothing.
class TwoServerRulesTest {
    private val servers = TwoServers()

    @AfterEach
    fun closeServers() = servers.close()

    @Test
    fun rule2_a_request_to_the_other_origin_fails_before_it_is_sent() {
        withSession(servers.a.origin) { _, factory ->
            refused(HttpRefusal.OTHER_ORIGIN) { fetch(factory, "http://127.0.0.1:${servers.b.port}/Items") }
        }
        assertEquals(0, servers.a.requestCount, "server A's request count")
        servers.assertBReceivedNothing()
    }

    @Test
    fun rule3_a_redirect_to_the_other_origin_is_an_error() {
        servers.a.enqueue(MockResponse(302, headersOf("Location", "http://127.0.0.1:${servers.b.port}/")))
        withSession(servers.a.origin) { _, factory ->
            refused(HttpRefusal.REDIRECT) { fetch(factory, servers.a.url("/Items")) }
        }
        assertEquals(1, servers.a.requestCount, "server A's request count")
        servers.assertBReceivedNothing()
    }

    @Test
    fun rule4_the_other_server_named_as_http_and_socks_proxy_is_not_used() {
        withSystemProperties(proxyProperties(servers.b)) {
            withSession(servers.a.origin) { _, factory ->
                assertEquals(200, fetch(factory, servers.a.url("/Items")))
            }
        }
        assertEquals("/Items", servers.a.requests.single().target, "server A received an origin-form target")
        servers.assertBReceivedNothing()
    }

    @Test
    fun rule5_user_info_and_a_credential_query_are_refused() {
        withSession(servers.a.origin) { _, factory ->
            refused(HttpRefusal.CREDENTIAL_URL) { fetch(factory, "http://user:pw@127.0.0.1:${servers.b.port}/Items") }
            refused(HttpRefusal.CREDENTIAL_URL) { fetch(factory, "http://127.0.0.1:${servers.a.port}/Items?ApiKey=x") }
        }
        assertEquals(0, servers.a.requestCount, "server A's request count")
        servers.assertBReceivedNothing()
    }

    @Test
    fun rule6_a_plain_http_session_to_a_public_address_is_refused() {
        // B listens on loopback, so it could not have been reached at this address anyway; this proves the code and
        // that no session exists.
        refused(HttpRefusal.PUBLIC_HTTP) { SessionRegistry.open("http://203.0.113.7:${servers.b.port}", authorization()) }
        servers.assertBReceivedNothing()
    }

    @Test
    fun rule7_only_the_session_server_receives_the_canary_header_and_the_answer_does_not_hand_it_back() {
        withSession(servers.a.origin) { _, factory ->
            get(factory, servers.a.url("/Items")).use { response ->
                assertEquals(200, response.code)
                response.body.string()
                assertNull(response.request.header("Authorization"), "response.request holds no Authorization")
                assertNull(response.networkResponse, "networkResponse")
                assertNull(response.priorResponse, "priorResponse")
                assertFalse(response.toString().contains(TestSupport.CANARY), "the answer's debug form")
            }
            refused(HttpRefusal.OTHER_ORIGIN) { fetch(factory, servers.b.url("/Items")) }
        }
        assertEquals(header(), servers.a.requests.single().headers["Authorization"], "server A received the canary header")
        servers.assertBReceivedNothing()
    }

    @Test
    fun every_rule_of_items_2_to_7_has_a_two_server_test() {
        val tests = TwoServerRulesTest::class.java.declaredMethods
            .filter { method -> method.annotations.any { it.annotationClass == Test::class } }
            .map { it.name }
        for (rule in 2..7) {
            assertTrue(tests.any { it.startsWith("rule${rule}_") }, "a test for rule $rule in $tests")
        }
    }
}
