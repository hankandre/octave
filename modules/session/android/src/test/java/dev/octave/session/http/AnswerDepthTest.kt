package dev.octave.session.http

import dev.octave.session.http.TransportTestSupport.json
import dev.octave.session.http.TransportTestSupport.passwordSignIn
import dev.octave.session.http.TransportTestSupport.sessionRequest
import dev.octave.session.http.TransportTestSupport.signIn
import dev.octave.session.http.TransportTestSupport.tokenlessRequest
import mockwebserver3.MockResponse
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

// T3-25 item 1 (docs/specs/T3-25.md, "The bound" and "The scan"): an answer under its size cap whose JSON nests deeper
// than 64 is refused as unexpected-response before it is parsed; depth 64 crosses. Depth is the largest number of
// arrays and objects open at one point of the text (a scalar is 0, [] is 1, {"a":[1]} is 2). The bound applies at
// every status and to a body whose first character after whitespace is [ or {; any other body is not scanned.
//
// Every case goes through SessionTransport and the one client to a MockWebServer on 127.0.0.1. Bodies are built here
// as compact JSON, so a crossing body equals the text sent. The bound, 64, is hard-coded; no main symbol for it is named.
class AnswerDepthTest {
    private val server = PathServer()

    @AfterEach
    fun close() = server.close()

    private fun withSession(block: (String) -> Unit) {
        val session = signIn(server)
        try {
            block(session)
        } finally {
            SessionRegistry.close(SessionId.parse(session)!!)
        }
    }

    // `[` x n then `]` x n: depth n.
    private fun arrays(n: Int): String = "[".repeat(n) + "]".repeat(n)

    // `{"a":` x n, then 1, then `}` x n: depth n.
    private fun objects(n: Int): String = "{\"a\":".repeat(n) + "1" + "}".repeat(n)

    // An array, then an object, and so on, n levels in all: depth n.
    private fun alternating(n: Int): String {
        val open = StringBuilder()
        val close = StringBuilder()
        for (level in 0 until n) {
            if (level % 2 == 0) {
                open.append("[")
                close.insert(0, "]")
            } else {
                open.append("{\"a\":")
                close.insert(0, "}")
            }
        }
        return open.toString() + "1" + close.toString()
    }

    private fun shapes(depth: Int): List<Pair<String, String>> =
        listOf("arrays" to arrays(depth), "objects" to objects(depth), "alternating" to alternating(depth))

    private fun refused(result: Map<String, Any?>, what: String) =
        assertEquals(mapOf("error" to "unexpected-response"), result, what)

    private fun crosses(code: Int, text: String?, result: Map<String, Any?>, what: String) =
        assertEquals(mapOf("status" to code, "body" to text), result, what)

    // A valid sign-in answer with one more field, `Deep`, holding `deep`.
    private fun signInWith(deep: String): String =
        """{"AccessToken":"depth-token","User":{"Id":"user-1","Name":"louise"},"ServerId":"server-1","Deep":$deep}"""

    // Closes a session a sign-in opened, so a case that fails on main leaves the registry as it found it.
    private fun closeIfOpened(result: Map<String, Any?>) {
        (result["session"] as? String)?.let { SessionId.parse(it) }?.let { SessionRegistry.close(it) }
    }

    @Test
    fun depth_65_on_a_session_get_and_post_is_unexpected() = withSession { session ->
        for ((shape, text) in shapes(65)) {
            server.answer("/Items") { json(200, text) }
            refused(sessionRequest(session, "GET", "/Items"), "$shape: session GET")
            server.answer("/Items/a/PlaybackInfo") { json(200, text) }
            refused(sessionRequest(session, "POST", "/Items/a/PlaybackInfo", mapOf("body" to "{}")), "$shape: session POST")
        }
    }

    @Test
    fun depth_65_on_a_tokenless_get_is_unexpected() {
        for ((shape, text) in shapes(65)) {
            server.answer("/System/Info/Public") { json(200, text) }
            refused(tokenlessRequest(server.origin, "GET", "/System/Info/Public"), "$shape: tokenless GET")
        }
    }

    @Test
    fun depth_65_with_an_error_status_is_unexpected() = withSession { session ->
        for (code in listOf(404, 500)) {
            for ((shape, text) in shapes(65)) {
                server.answer("/Items") { json(code, text) }
                refused(sessionRequest(session, "GET", "/Items"), "$shape: status $code")
            }
        }
    }

    @Test
    fun a_sign_in_answer_with_a_field_nested_65_deep_is_unexpected_and_has_no_session() {
        for ((shape, deep) in shapes(64)) {
            // The field sits inside the sign-in object, so the answer's depth is 65.
            server.answer("/Users/AuthenticateByName") { json(200, signInWith(deep)) }
            val result = passwordSignIn(server.origin)
            try {
                refused(result, "$shape: password sign-in")
            } finally {
                closeIfOpened(result)
            }
        }
    }

    // Spec-check note 6: an error status does not lift the bound, so a 401 with a deep body is not status.
    @Test
    fun a_401_sign_in_answer_nested_65_deep_is_unexpected_not_status() {
        for ((shape, text) in shapes(65)) {
            server.answer("/Users/AuthenticateByName") { json(401, text) }
            val result = passwordSignIn(server.origin)
            try {
                refused(result, "$shape: a 401 sign-in")
            } finally {
                closeIfOpened(result)
            }
        }
    }

    // About 200 KB, under every cap. On main the library's reader recurses once per `[` and overflows the stack.
    @Test
    fun a_100_000_deep_array_closed_or_unclosed_is_unexpected() = withSession { session ->
        // One ordinary nested answer first, so no class is first loaded at the edge of the stack.
        server.answer("/Items") { json(200, arrays(8)) }
        crosses(200, arrays(8), sessionRequest(session, "GET", "/Items"), "a depth-8 answer crosses")
        val closed = arrays(100_000)
        val unclosed = "[".repeat(100_000)
        for ((form, text) in listOf("closed" to closed, "unclosed" to unclosed)) {
            server.answer("/Items") { json(200, text) }
            refused(sessionRequest(session, "GET", "/Items"), "$form: a 100 000-deep array")
        }
    }

    @Test
    fun sixty_five_unclosed_brackets_before_text_that_is_not_json_is_unexpected() = withSession { session ->
        server.answer("/Items") { json(200, "[".repeat(65) + "this is not json") }
        refused(sessionRequest(session, "GET", "/Items"), "65 unclosed [ then text that is not JSON")
    }

    @Test
    fun depth_65_after_leading_whitespace_is_unexpected() = withSession { session ->
        for ((name, lead) in listOf("space" to " ", "tab" to "\t", "line feed" to "\n", "carriage return" to "\r", "all four" to " \t\n\r")) {
            server.answer("/Items") { json(200, lead + arrays(65)) }
            refused(sessionRequest(session, "GET", "/Items"), "depth 65 after a leading $name")
        }
    }

    // `["a\\",[[...]]]`: the string ends at the quote after an escaped backslash, and 64 real levels follow inside the
    // outer array, so the depth is 65. A scan that takes `\\"` for an escaped quote stays inside the string and counts 1.
    @Test
    fun an_escaped_backslash_ends_the_string_and_the_levels_after_it_count() = withSession { session ->
        val text = "[\"a\\\\\"," + arrays(64) + "]"
        server.answer("/Items") { json(200, text) }
        refused(sessionRequest(session, "GET", "/Items"), "a string ending in an escaped backslash, then 64 levels inside the outer array")
    }

    @Test
    fun depth_64_crosses_on_a_session() = withSession { session ->
        for ((shape, text) in shapes(64)) {
            server.answer("/Items") { json(200, text) }
            crosses(200, text, sessionRequest(session, "GET", "/Items"), "$shape: depth 64, session GET")
            server.answer("/Items/a/PlaybackInfo") { json(200, text) }
            crosses(200, text, sessionRequest(session, "POST", "/Items/a/PlaybackInfo", mapOf("body" to "{}")), "$shape: depth 64, session POST")
        }
    }

    @Test
    fun depth_64_with_status_404_crosses_with_its_body() = withSession { session ->
        for ((shape, text) in shapes(64)) {
            server.answer("/Items") { json(404, text) }
            crosses(404, text, sessionRequest(session, "GET", "/Items"), "$shape: depth 64, status 404")
        }
    }

    @Test
    fun brackets_inside_strings_do_not_count() = withSession { session ->
        val cases = listOf(
            // Depth 1, holding a string of 1 000 [ and { characters.
            "a string of 1 000 brackets" to "[\"" + "[{".repeat(500) + "\"]",
            // An escaped quote does not end the string, so the 100 [ after it are inside it.
            "an escaped quote then 100 [" to "[\"a\\\"" + "[".repeat(100) + "\"]",
        )
        for ((what, text) in cases) {
            server.answer("/Items") { json(200, text) }
            crosses(200, text, sessionRequest(session, "GET", "/Items"), what)
        }
    }

    // 100 sibling arrays at depth 2: a scan that never counts down would reach 101.
    @Test
    fun sibling_arrays_count_down_as_they_close() = withSession { session ->
        val text = "[" + List(100) { "[]" }.joinToString(",") + "]"
        server.answer("/Items") { json(200, text) }
        crosses(200, text, sessionRequest(session, "GET", "/Items"), "100 sibling arrays at depth 2")
    }

    // Control, green on main: a body that begins with `<` is not scanned, so an HTML page with 100 [ keeps its status
    // and crosses with no body.
    @Test
    fun an_html_page_holding_brackets_crosses_as_a_status_with_no_body() = withSession { session ->
        val page = "<html>" + "[".repeat(100) + "</html>"
        server.answer("/Items") { MockResponse.Builder().code(502).addHeader("Content-Type", "text/html").body(page).build() }
        crosses(502, null, sessionRequest(session, "GET", "/Items"), "an HTML page with 100 [ and status 502")
    }
}
