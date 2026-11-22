package dev.octave.session.http

import dev.octave.session.http.TransportTestSupport.sessionRequest
import dev.octave.session.http.TransportTestSupport.signIn
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Request
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource
import org.junit.jupiter.params.provider.ValueSource
import java.io.File

// T3-16 item 7 (docs/specs/T3-16.md, "The path rule"): a request path that holds a . or .. segment, as written or
// percent-encoded (%2e in either case), is refused before anything is sent, and the URL sent stays under the session's
// base path. One invocation per vector of packages/core/tests/fixtures/request-paths.json, each on a session with the
// base path /jf and on one with none: a refused path resolves { error: "refused" } and the server records nothing
// after the sign-in; an accepted path reaches the server as the base path plus the path, byte for byte.
//
// The one client holds every session call to the base path too (C2): a call through OctaveHttp.callFactory(session)
// to a URL outside /jf is refused with the code outside-base-path, read from OctaveHttpException.refusal.code so this
// file names no symbol main lacks.
class RequestPathTest {
    private val server = PathServer()

    @AfterEach
    fun close() = server.close()

    // Signs in on `base` (the origin plus a base path, or none), clears the record, sends `path`, and closes the session.
    private fun send(base: String, path: String): Map<String, Any?> {
        val session = signIn(server, server.origin + base)
        server.requests.clear()
        try {
            return sessionRequest(session, "GET", path)
        } finally {
            SessionRegistry.close(SessionId.parse(session)!!)
        }
    }

    @ParameterizedTest(name = "refused {0} on base path \"{2}\"")
    @MethodSource("refusedCases")
    fun a_dot_segment_or_unsafe_path_is_refused_and_sends_nothing(name: String, path: String, base: String) {
        val result = send(base, path)
        val sent = server.requests.map { it.target }
        assertEquals(mapOf("error" to "refused"), result, "$name: result (the server received $sent)")
        assertEquals(emptyList<String>(), sent, "$name: nothing was sent")
    }

    @ParameterizedTest(name = "accepted {0} on base path \"{2}\"")
    @MethodSource("acceptedCases")
    fun an_accepted_path_reaches_the_server_as_the_base_path_plus_the_path(name: String, path: String, base: String) {
        val result = send(base, path)
        assertEquals(404, result["status"], "$name: the request was sent and answered (result $result)")
        assertEquals(listOf(base + path), server.requests.map { it.target }, "$name: the target sent")
    }

    // C1: a path OkHttp would rewrite is refused natively, so the URL sent is the base path plus the path as written.
    // The reference transport has no C1, which is why these are not in the shared vectors.
    @ParameterizedTest(name = "{0}")
    @ValueSource(strings = ["/Items/a b", "/Items/ü", "/Items/a\"b", "/Items/a<b>", "/Items/a{b}"])
    fun a_path_okhttp_would_rewrite_is_refused_natively(path: String) {
        for (base in listOf("/jf", "")) {
            val result = send(base, path)
            val sent = server.requests.map { it.target }
            assertEquals(mapOf("error" to "refused"), result, "base \"$base\": result (the server received $sent)")
            assertEquals(emptyList<String>(), sent, "base \"$base\": nothing was sent")
        }
    }

    @Test
    fun a_session_call_outside_the_base_path_is_refused_by_the_one_client() {
        for (outside in listOf("/x", "/jf2/x", "/", "/j", "/Items")) {
            TestSupport.withSession("${server.origin}/jf") { _, factory ->
                val error = assertThrows(OctaveHttpException::class.java, {
                    factory.newCall(Request.Builder().url(server.origin + outside).build()).execute().close()
                }, "$outside is refused")
                assertEquals("outside-base-path", error.refusal.code, "$outside: refusal code")
            }
        }
        assertEquals(emptyList<String>(), server.requests.map { it.target }, "nothing was sent")
    }

    @Test
    fun a_session_call_under_the_base_path_is_sent() {
        for (inside in listOf("/jf", "/jf/", "/jf/Items")) {
            val code = TestSupport.withSession("${server.origin}/jf") { _, factory -> TestSupport.fetch(factory, server.origin + inside) }
            assertEquals(404, code, "$inside is sent")
        }
        assertEquals(listOf("/jf", "/jf/", "/jf/Items"), server.requests.map { it.target })
    }

    companion object {
        private val BASES = listOf("/jf", "")

        private fun vectors(group: String): List<Pair<String, String>> {
            val root = File(checkNotNull(System.getProperty("octave.repoRoot")) { "system property octave.repoRoot is not set" })
            val fixture = Json.parseToJsonElement(File(root, "packages/core/tests/fixtures/request-paths.json").readText()).jsonObject
            return fixture[group]!!.jsonArray.map { it.jsonObject }.map { it["name"]!!.jsonPrimitive.content to it["path"]!!.jsonPrimitive.content }
        }

        @JvmStatic
        fun refusedCases(): List<Arguments> = vectors("refused").flatMap { (name, path) -> BASES.map { Arguments.of(name, path, it) } }

        @JvmStatic
        fun acceptedCases(): List<Arguments> = vectors("accepted").flatMap { (name, path) -> BASES.map { Arguments.of(name, path, it) } }
    }
}
