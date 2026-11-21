package dev.octave.session.http

import dev.octave.session.http.TestSupport.fetch
import dev.octave.session.http.TestSupport.header
import dev.octave.session.http.TestSupport.refused
import dev.octave.session.http.TestSupport.withSession
import mockwebserver3.MockResponse
import okhttp3.Headers.Companion.headersOf
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource

// T3-03 item 3: followRedirects and followSslRedirects are off; a 3xx answer is returned as an error and the redirect
// target receives nothing. The interceptor refuses the whole range 300 to 399, so 300 and 304 are here too.
class RedirectTest {
    private val servers = TwoServers()

    @AfterEach
    fun closeServers() = servers.close()

    @Test
    fun the_client_follows_no_redirect() {
        assertFalse(OctaveHttp.client.followRedirects, "followRedirects")
        assertFalse(OctaveHttp.client.followSslRedirects, "followSslRedirects")
    }

    @ParameterizedTest
    @ValueSource(ints = [300, 301, 302, 303, 304, 307, 308])
    fun a_redirect_to_another_origin_is_an_error_and_the_target_receives_nothing(code: Int) {
        servers.a.enqueue(MockResponse(code, headersOf("Location", servers.b.url("/Items"))))
        withSession(servers.a.origin) { _, factory ->
            refused(HttpRefusal.REDIRECT) { fetch(factory, servers.a.url("/Items")) }
        }
        assertEquals(1, servers.a.requestCount, "server A's request count")
        assertEquals(header(), servers.a.requests.single().headers["Authorization"])
        servers.assertBReceivedNothing()
    }

    @ParameterizedTest
    @ValueSource(ints = [301, 302, 307])
    fun a_redirect_to_a_path_on_the_same_server_is_an_error_too(code: Int) {
        servers.a.enqueue(MockResponse(code, headersOf("Location", "/Elsewhere")))
        withSession(servers.a.origin) { _, factory ->
            refused(HttpRefusal.REDIRECT) { fetch(factory, servers.a.url("/Items")) }
        }
        assertEquals(1, servers.a.requestCount, "server A's request count")
        assertEquals("/Items", servers.a.requests.single().target, "the redirect was not followed")
        servers.assertBReceivedNothing()
    }
}
