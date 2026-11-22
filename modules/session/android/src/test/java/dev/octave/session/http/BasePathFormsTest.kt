package dev.octave.session.http

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource

// T3-24 item 4 (docs/specs/T3-24.md, "C2"): the one client applies the additions of items 1 to 3 to the encoded path
// of every session and closing call, not only to SessionTransport.request. A call through
// OctaveHttp.callFactory(session) for each form is refused with the code outside-base-path and nothing is sent. Each
// case first asserts that OkHttp 5.5.1 keeps the target's encoded path as written, under the base path, so the prefix
// check alone would pass (the precondition BasePathDotSegmentTest.refused asserts; spec-check note 6). Every form's
// precondition held when these tests were frozen. The closing half goes through RequestPolicy.checkClosing on a
// hand-built SessionEntry, as LogoutTest.the_closing_authority_sends_only_the_logout builds its entry, so no test signs
// in on a base path that holds a form; check and checkClosing reach the same checkBasePath.
class BasePathFormsTest {
    private val server = PathServer()

    @AfterEach
    fun close() = server.close()

    @ParameterizedTest(name = "refused {1} on base path {0}")
    @MethodSource("refusedCases")
    fun a_session_call_whose_encoded_path_holds_a_form_is_refused_by_the_one_client(base: String, target: String) {
        val url = server.origin + target
        // The case is only meaningful if OkHttp keeps the path as written, under the base path.
        assertEquals(target, url.toHttpUrl().encodedPath, "$target: OkHttp keeps the encoded path as written")
        TestSupport.withSession(server.origin + base) { _, factory ->
            val error = assertThrows(OctaveHttpException::class.java, {
                factory.newCall(Request.Builder().url(url).build()).execute().close()
            }, "$target is refused")
            assertEquals("outside-base-path", error.refusal.code, "$target: refusal code")
        }
        assertEquals(emptyList<String>(), server.requests.map { it.target }, "$target: nothing was sent")
    }

    @Test
    fun a_near_miss_is_still_sent_by_the_one_client() {
        val inside = listOf("/jf/Items/a%3Ab", "/jf/Items/100%25")
        for (target in inside) {
            val code = TestSupport.withSession("${server.origin}/jf") { _, factory -> TestSupport.fetch(factory, server.origin + target) }
            assertEquals(404, code, "$target is sent")
        }
        assertEquals(inside, server.requests.map { it.target })
    }

    @Test
    fun the_closing_authority_refuses_a_logout_whose_base_path_holds_a_form() {
        fun check(basePath: String): HttpRefusal? {
            val entry = SessionEntry("http", "127.0.0.1", 8096, TestSupport.authorization(), basePath)
            val url = "http://127.0.0.1:8096$basePath/Sessions/Logout"
            assertEquals("$basePath/Sessions/Logout", url.toHttpUrl().encodedPath, "$basePath: OkHttp keeps the logout path as written")
            return RequestPolicy.checkClosing(entry, Request.Builder().url(url).method("POST", ByteArray(0).toRequestBody(null)).build())
        }
        assertNull(check("/jf"), "the logout under /jf is allowed")
        assertEquals(HttpRefusal.OUTSIDE_BASE_PATH, check("/jf;x"), "the logout under /jf;x is refused")
    }

    companion object {
        private val FORMS = listOf(
            "/jf/Items/..;/x",
            "/jf/Items/..%3b/x",
            "/jf/Items/..%00/x",
            "/jf/Items/%ef%bc%8e%ef%bc%8e/x",
            "/jf/Items/%25c0%25ae%25c0%25ae/x",
            "/jf/Items/%252525252e%252525252e/x",
        )

        private val FORMS_WITHOUT_A_BASE_PATH = listOf("/Items/..;/x", "/Items/%ef%bc%8e%ef%bc%8e/x")

        @JvmStatic
        fun refusedCases(): List<Arguments> =
            FORMS.map { Arguments.of("/jf", it) } + FORMS_WITHOUT_A_BASE_PATH.map { Arguments.of("", it) }
    }
}
