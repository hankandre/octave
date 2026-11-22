package dev.octave.session.http

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// T3-16 review fix (medium): C2 holds every caller of OctaveHttp.callFactory(session) to the base path, not only
// SessionTransport.request. OkHttp 5.5.1 resolves plain and %2e dot segments when it builds a URL, but leaves ..%2f,
// ..%5c and %252e%252e in the encoded path, where a proxy that decodes before it resolves could still read a step out
// of the base path. So the one client runs P4 (dot segments after up to four rounds of decoding) and P5 (UTF-8 escapes)
// on the encoded path of every session call too, with the refusal outside-base-path.
class BasePathDotSegmentTest {
    private val server = PathServer()

    @AfterEach
    fun close() = server.close()

    private fun refused(base: String, targets: List<String>) {
        for (target in targets) {
            val url = server.origin + target
            // The case is only meaningful if OkHttp keeps the path under the base path, so the prefix check alone passes.
            assertTrue(url.toHttpUrl().encodedPath.startsWith("$base/"), "$target: OkHttp keeps it under \"$base\" (${url.toHttpUrl().encodedPath})")
            TestSupport.withSession(server.origin + base) { _, factory ->
                val error = assertThrows(OctaveHttpException::class.java, {
                    factory.newCall(Request.Builder().url(url).build()).execute().close()
                }, "$target is refused")
                assertEquals("outside-base-path", error.refusal.code, "$target: refusal code")
            }
        }
        assertEquals(emptyList<String>(), server.requests.map { it.target }, "nothing was sent")
    }

    @Test
    fun an_encoded_dot_segment_okhttp_leaves_in_the_path_is_refused_by_the_one_client() {
        refused(
            "/jf",
            listOf(
                "/jf/..%2f..%2fadmin",
                "/jf/..%2F..%2Fadmin",
                "/jf/..%5cx",
                "/jf/%252e%252e/x",
                "/jf/%252E%252E%252fadmin",
                "/jf/Items/%25252e%25252e/x",
                "/jf/.%252e/x",
            ),
        )
    }

    @Test
    fun an_escape_that_is_not_utf8_is_refused_by_the_one_client() {
        refused("/jf", listOf("/jf/Items/%c0%ae%c0%ae/x", "/jf/Items/%ed%a0%80", "/jf/Items/%80"))
    }

    @Test
    fun an_empty_base_path_still_refuses_an_encoded_dot_segment() {
        val targets = listOf("/Items/..%2f..%2fx", "/Items/%252e%252e/x")
        for (target in targets) {
            TestSupport.withSession(server.origin) { _, factory ->
                val error = assertThrows(OctaveHttpException::class.java, {
                    factory.newCall(Request.Builder().url(server.origin + target).build()).execute().close()
                }, "$target is refused")
                assertEquals("outside-base-path", error.refusal.code, "$target: refusal code")
            }
        }
        assertEquals(emptyList<String>(), server.requests.map { it.target }, "nothing was sent")
    }

    @Test
    fun a_path_with_dots_or_escapes_inside_segments_is_still_sent() {
        val inside = listOf("/jf/Items/a..b", "/jf/Items/.hidden", "/jf/Items/...", "/jf/Items/a%2Fb", "/jf/Items/100%25", "/jf/Items/%C3%BC", "/jf/Items/a%2eb")
        for (target in inside) {
            val code = TestSupport.withSession("${server.origin}/jf") { _, factory -> TestSupport.fetch(factory, server.origin + target) }
            assertEquals(404, code, "$target is sent")
        }
        assertEquals(inside, server.requests.map { it.target })
    }
}
