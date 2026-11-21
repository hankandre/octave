package dev.octave.session.http

import okhttp3.Request
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

// T3-03: RequestPolicy's order of checks, called directly with hand-made session entries, including check 6, which
// the public surface cannot reach (open refuses a public plain-HTTP session first).
class RequestPolicyTest {
    private val authorization = TestSupport.authorization()
    private val entry = SessionEntry("http", "127.0.0.1", 8096, authorization)

    private fun check(url: String, entry: SessionEntry? = this.entry, header: Pair<String, String>? = null): HttpRefusal? {
        val request = Request.Builder().url(url).apply { header?.let { addHeader(it.first, it.second) } }.build()
        return RequestPolicy.check(entry, request)
    }

    @Test
    fun check_6_refuses_plain_http_to_a_public_host() {
        val public = SessionEntry("http", "203.0.113.7", 80, authorization)
        assertEquals(HttpRefusal.PUBLIC_HTTP, check("http://203.0.113.7/Items", public))
        assertEquals(HttpRefusal.PUBLIC_HTTP, check("http://media.example/Items", SessionEntry("http", "media.example", 80, authorization)))
        assertEquals(null, check("https://203.0.113.7/Items", SessionEntry("https", "203.0.113.7", 443, authorization)))
        assertEquals(null, check("http://192.168.1.5/", SessionEntry("http", "192.168.1.5", 80, authorization)))
    }

    @Test
    fun the_first_failing_check_wins() {
        val other = "http://127.0.0.1:9999"
        val cases = listOf(
            Triple("http://127.0.0.1:8096/Items", null as Pair<String, String>?, null),
            Triple("http://user@127.0.0.1:9999/?ApiKey=x", "Cookie" to "a=1", HttpRefusal.HEADER_NOT_ALLOWED),
            Triple("http://user@127.0.0.1:9999/?ApiKey=x", null, HttpRefusal.CREDENTIAL_URL),
            Triple("$other/?ApiKey=x", null, HttpRefusal.OTHER_ORIGIN),
            Triple("https://127.0.0.1:8096/", null, HttpRefusal.OTHER_ORIGIN),
            Triple("http://127.0.0.1:8096/?ApiKey=x", null, HttpRefusal.CREDENTIAL_URL),
            Triple("http://127.0.0.1:8096/?+api_key=x", null, HttpRefusal.CREDENTIAL_URL),
            Triple("http://127.0.0.1:8096/Items/${TestSupport.CANARY}", null, HttpRefusal.CREDENTIAL_URL),
            Triple("http://127.0.0.1:8096/?q=%zz&deviceId=1", null, null),
        )
        for ((url, header, expected) in cases) {
            assertEquals(expected, check(url, header = header), url)
        }
        assertEquals(HttpRefusal.NO_SESSION, check("http://user@127.0.0.1:9999/", entry = null, header = "Cookie" to "a=1"))
    }
}
