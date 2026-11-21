package dev.octave.session.http

import dev.octave.session.http.TestSupport.fetch
import dev.octave.session.http.TestSupport.withSession
import mockwebserver3.MockResponse
import okhttp3.CookieJar
import okhttp3.Headers.Companion.headersOf
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Test

// T3-03: the one client stores no cookie (AGENTS.md, Tokens and network; docs/security.md).
class NoCookieTest {
    private val servers = TwoServers()

    @AfterEach
    fun closeServers() = servers.close()

    @Test
    fun a_cookie_the_server_sets_is_never_sent_back() {
        assertSame(CookieJar.NO_COOKIES, OctaveHttp.client.cookieJar, "cookie jar")
        servers.a.enqueue(MockResponse(200, headersOf("Set-Cookie", "session=abc; Path=/")))
        withSession(servers.a.origin) { _, factory ->
            assertEquals(200, fetch(factory, servers.a.url("/Users/AuthenticateByName")))
            assertEquals(200, fetch(factory, servers.a.url("/Items")))
        }
        assertEquals(2, servers.a.requests.size)
        assertNull(servers.a.requests[1].headers["Cookie"], "the second request's Cookie header")
        servers.assertBReceivedNothing()
    }
}
