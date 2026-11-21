package dev.octave.session.http

import dev.octave.session.http.TestSupport.fetch
import dev.octave.session.http.TestSupport.refused
import dev.octave.session.http.TestSupport.withSession
import okhttp3.Request
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

// T3-03 review fix: a caller may not bring a header that names another host or carries another credential. Host and
// :authority would let a virtual-host proxy route the session's header to another backend; Forwarded and X-Forwarded-*
// do the same at proxies that trust them; X-Emby-* and X-MediaBrowser-* carry Jellyfin credentials that would replace
// the session's (docs/specs/T3-03.md, check 2).
class CallerHeaderTest {
    private val servers = TwoServers()

    @AfterEach
    fun closeServers() = servers.close()

    private val entry = SessionEntry("http", "127.0.0.1", 8096, TestSupport.authorization())

    private fun check(name: String, value: String): HttpRefusal? =
        RequestPolicy.check(entry, Request.Builder().url("http://127.0.0.1:8096/Items").addHeader(name, value).build())

    @Test
    fun headers_that_name_a_host_or_carry_a_credential_are_refused_in_any_case() {
        val refusedHeaders = listOf(
            "Host" to "other-app.lan",
            "host" to "127.0.0.1:8096",
            "Forwarded" to "host=other-app.lan",
            "X-Forwarded-Host" to "other-app.lan",
            "x-forwarded-for" to "10.0.0.1",
            "X-Emby-Authorization" to "MediaBrowser Token=\"other\"",
            "X-Emby-Token" to "other",
            "x-emby-token" to "other",
            "X-MediaBrowser-Token" to "other",
            "Proxy-Connection" to "keep-alive",
            "Cookie2" to "a=1",
            ":authority" to "other-app.lan",
        )
        for ((name, value) in refusedHeaders) {
            assertEquals(HttpRefusal.HEADER_NOT_ALLOWED, check(name, value), name)
        }
    }

    @Test
    fun ordinary_headers_still_pass() {
        for ((name, value) in listOf("Range" to "bytes=0-", "Accept" to "application/json", "User-Agent" to "Octave", "If-None-Match" to "\"1\"")) {
            assertEquals(null, check(name, value), name)
        }
    }

    @Test
    fun a_caller_host_header_is_refused_before_anything_is_sent() {
        withSession(servers.a.origin) { _, factory ->
            for ((name, value) in listOf("Host" to "other-app.lan", "X-Emby-Token" to "other", "Forwarded" to "host=other-app.lan")) {
                refused(HttpRefusal.HEADER_NOT_ALLOWED) { fetch(factory, servers.a.url("/Items")) { addHeader(name, value) } }
            }
        }
        assertEquals(0, servers.a.requestCount, "server A's request count")
        assertEquals(0, servers.a.connections, "connections server A accepted")
        servers.assertBReceivedNothing()
    }
}
