package dev.octave.session.http

import dev.octave.session.http.TestSupport.CANARY
import dev.octave.session.http.TestSupport.authorization
import dev.octave.session.http.TestSupport.fetch
import dev.octave.session.http.TestSupport.fixture
import dev.octave.session.http.TestSupport.get
import dev.octave.session.http.TestSupport.header
import dev.octave.session.http.TestSupport.mainSources
import dev.octave.session.http.TestSupport.withSession
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import mockwebserver3.MockResponse
import okhttp3.Headers.Companion.headersOf
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.ByteArrayOutputStream
import java.io.PrintStream
import java.lang.reflect.Modifier

// T3-03 item 7: the header value is accepted only as a MediaBrowser value with a token, at most 4 KB, with no control
// character; it is never logged and its debug form is redacted.
class AuthorizationValueTest {
    private val servers = TwoServers()

    @AfterEach
    fun closeServers() = servers.close()

    private val vectors: List<JsonObject> = fixture("authorization-header.json")["vectors"]!!.jsonArray.map { it.jsonObject }
    private val typical: String = vectors.single { it.string("name") == "typical" }.string("expected")!!

    private fun JsonObject.string(key: String): String? = this[key]?.jsonPrimitive?.content

    private fun accepts(value: String) = assertNotNull(MediaBrowserAuthorization.parse(value), "accepts: $value")
    private fun refuses(value: String, why: String) = assertNull(MediaBrowserAuthorization.parse(value), "refuses $why: $value")

    // The typical vector with its token padded with `a` until the whole value is `bytes` UTF-8 bytes long.
    private fun typicalPaddedTo(bytes: Int): String {
        val open = typical.dropLast(1)
        val value = open + "a".repeat(bytes - open.toByteArray(Charsets.UTF_8).size - 1) + "\""
        assertEquals(bytes, value.toByteArray(Charsets.UTF_8).size, "padded length")
        return value
    }

    @Test
    fun the_builder_values_with_a_token_are_accepted() {
        val withToken = vectors.filter { it.containsKey("token") }
        assertEquals(4, withToken.size, "vectors with a token")
        withToken.forEach { accepts(it.string("expected")!!) }
    }

    @Test
    fun a_value_of_4096_bytes_is_accepted_and_one_more_byte_is_refused() {
        assertEquals(4096, MediaBrowserAuthorization.MAX_BYTES)
        accepts(typicalPaddedTo(4096))
        refuses(typicalPaddedTo(4097), "4097 bytes")
    }

    @Test
    fun a_value_without_a_token_or_in_another_scheme_is_refused() {
        assertEquals(5, vectors.size, "vectors")
        vectors.forEach { refuses(it.string("expectedWithoutToken")!!, "an empty token (${it.string("name")})") }
        refuses(vectors.single { it.string("name") == "probe-identity" }.string("expected")!!, "probe-identity's tokenless value")
        refuses("", "an empty value")
        refuses("Bearer 0123456789abcdef0123456789abcdef", "a Bearer value")
        refuses("Emby Token=\"0123456789abcdef0123456789abcdef\"", "an Emby value")
        refuses("mediabrowser Token=\"0123456789abcdef0123456789abcdef\"", "a lower-case scheme with one field")
        refuses(typical.replaceFirst("MediaBrowser ", "mediabrowser "), "a lower-case scheme")
    }

    @Test
    fun a_control_or_non_ascii_character_is_refused() {
        for ((char, name) in listOf('\r' to "CR", '\n' to "LF", '\u0000' to "NUL", '\t' to "TAB", '\u007f' to "DEL", 'é' to "U+00E9")) {
            refuses(typical.replace("Octave%20Android%20TV", "Octave${char}Android%20TV"), "$name in a value")
            refuses(typical.replace("Token=\"0123", "Token=\"0${char}123"), "$name in the token")
        }
    }

    @Test
    fun only_the_builder_shape_is_accepted() {
        val token = "Token=\"0123456789abcdef0123456789abcdef\""
        val version = "Version=\"0.1.0\""
        assertTrue(typical.endsWith(", $version, $token"), "the typical vector ends with Version then Token")
        val shapes = mapOf(
            "Token not the last field" to typical.replace("$version, $token", "$token, $version"),
            "two Token fields" to "$typical, $token",
            "a missing field" to typical.replace("$version, ", ""),
            "a sixth field" to typical.replace(", $token", ", Extra=\"1\", $token"),
            "fields joined by a comma alone" to typical.replace("\", ", "\","),
            "fields joined by a comma and two spaces" to typical.replace("\", ", "\",  "),
            "a leading space" to " $typical",
            "a trailing space" to "$typical ",
            "a trailing LF" to "$typical\n",
            "a quote inside a value" to typical.replace("Octave%20Android", "Octave\"Android"),
            "a space inside a value" to typical.replace("Octave%20Android", "Octave Android"),
            "a % not followed by two hex digits" to typical.replace("Octave%20Android", "Octave%2GAndroid"),
            "a lone % at the end of a value" to typical.replace("Version=\"0.1.0\"", "Version=\"0.1.0%\""),
            "a lower-case escape" to typical.replace("Octave%20Android", "Octave%2bAndroid"),
            "a field name in another case" to typical.replace("Token=", "token="),
        )
        for ((why, value) in shapes) {
            assertFalse(value == typical, "the $why case changes the value")
            refuses(value, why)
        }
        accepts(typical)
    }

    @Test
    fun parse_returns_rather_than_throws_on_long_values_and_small_stacks() {
        val long4096 = typicalPaddedTo(4096)
        val unclosed = typical.dropLast(1) + "a".repeat(4096 - typical.length)
        val huge = typical.dropLast(1) + "a".repeat(1_000_000) + "\""
        // Load and initialise the parser on the test thread, so the small stack measures parse, not class loading.
        assertNotNull(MediaBrowserAuthorization.parse(typical), "the typical value is accepted")
        val results = arrayOfNulls<Any>(3)
        var thrown: Throwable? = null
        val thread = Thread(null, {
            try {
                results[0] = MediaBrowserAuthorization.parse(long4096)
                results[1] = MediaBrowserAuthorization.parse(unclosed) ?: "null"
                results[2] = MediaBrowserAuthorization.parse(huge) ?: "null"
            } catch (error: Throwable) {
                thrown = error
            }
        }, "small-stack", 128L * 1024)
        thread.start()
        thread.join()
        assertNull(thrown, "parse threw on a small stack")
        assertTrue(results[0] is MediaBrowserAuthorization, "the 4096-byte value is accepted on a small stack")
        assertEquals("null", results[1], "an unclosed value is refused")
        assertEquals("null", results[2], "a value over the limit is refused")
    }

    @Test
    fun the_debug_form_is_redacted_and_nothing_reads_the_value_back() {
        val value = authorization()
        assertEquals("MediaBrowserAuthorization([redacted])", value.toString())
        assertEquals("MediaBrowserAuthorization([redacted])", "$value")
        assertFalse(listOf(value).toString().contains(CANARY), "a collection's debug form")
        val type = MediaBrowserAuthorization::class.java
        val accessors = type.declaredMethods.filter {
            Modifier.isPublic(it.modifiers) && !Modifier.isStatic(it.modifiers) && !it.isSynthetic && !it.name.contains('$') &&
                it.name !in setOf("toString", "equals", "hashCode")
        }
        assertTrue(accessors.isEmpty(), "public accessors: ${accessors.map { it.name }}")
        val fields = type.declaredFields.filter { Modifier.isPublic(it.modifiers) && !Modifier.isStatic(it.modifiers) }
        assertTrue(fields.isEmpty(), "public fields: ${fields.map { it.name }}")
    }

    @Test
    fun no_exception_for_a_canary_session_holds_the_canary() {
        val errors = mutableListOf<OctaveHttpException>()
        fun collect(block: () -> Unit) {
            try {
                block()
            } catch (error: OctaveHttpException) {
                errors.add(error)
            }
        }
        servers.a.enqueue(MockResponse(302, headersOf("Location", servers.b.url("/$CANARY"))))
        val session = SessionRegistry.open(servers.a.origin, authorization())
        val factory = OctaveHttp.callFactory(session)
        try {
            collect { fetch(factory, servers.a.url("/Items")) } // redirect
            collect { fetch(factory, servers.b.url("/$CANARY")) } // other-origin
            collect { fetch(factory, servers.a.url("/Items?SearchTerm=$CANARY")) } // credential-url (token)
            collect { fetch(factory, servers.a.url("/Items?api_key=$CANARY")) } // credential-url (name)
            collect { fetch(factory, "http://$CANARY:$CANARY@127.0.0.1:${servers.a.port}/") } // credential-url (user info)
            collect { fetch(factory, servers.a.url("/Items")) { addHeader("Authorization", header()) } } // header-not-allowed
            assertFalse(session.toString().contains(CANARY), "the session id's debug form")
            assertFalse(factory.toString().contains(CANARY), "the call factory's debug form")
        } finally {
            SessionRegistry.close(session)
        }
        collect { fetch(factory, servers.a.url("/Items")) } // no-session, after close
        collect { SessionRegistry.open("http://203.0.113.7/$CANARY", authorization()) } // public-http
        collect { SessionRegistry.open("https://$CANARY@media.example", authorization()) } // invalid-address
        assertEquals(
            listOf("redirect", "other-origin", "credential-url", "credential-url", "credential-url", "header-not-allowed", "no-session", "public-http", "invalid-address"),
            errors.map { it.refusal.code },
            "the refusals collected",
        )
        for (error in errors) {
            assertEquals(error.refusal.code, error.message, "the message is the code")
            assertNull(error.cause, "no cause")
            assertFalse(error.toString().contains(CANARY), "toString of ${error.refusal}")
            assertFalse(error.stackTraceToString().contains(CANARY), "stack trace of ${error.refusal}")
        }
        servers.assertBReceivedNothing()
    }

    @Test
    fun the_module_main_source_has_no_log_call() {
        val files = mainSources(TestSupport.sessionMain)
        assertTrue(mainSources(TestSupport.sessionHttpMain).isNotEmpty(), "modules/session holds the HTTP package's main source")
        for (word in listOf("android.util.Log", "println", "System.out", "System.err", "Logger", "Timber", "HttpLoggingInterceptor")) {
            val hits = files.filter { it.readText().contains(word) }.map { it.invariantSeparatorsPath }
            assertTrue(hits.isEmpty(), "$word appears in $hits")
        }
    }

    @Test
    fun standard_output_and_error_hold_no_canary_across_a_canary_request() {
        val captured = ByteArrayOutputStream()
        val capture = PrintStream(captured, true, "UTF-8")
        val out = System.out
        val err = System.err
        System.setOut(capture)
        System.setErr(capture)
        try {
            withSession(servers.a.origin) { _, factory ->
                get(factory, servers.a.url("/Items")).use { response ->
                    response.body.string()
                    println(response)
                    println(response.request)
                }
                try {
                    fetch(factory, servers.b.url("/Items"))
                } catch (error: OctaveHttpException) {
                    error.printStackTrace()
                }
            }
        } finally {
            System.setOut(out)
            System.setErr(err)
        }
        assertEquals(header(), servers.a.requests.single().headers["Authorization"], "server A received the canary header")
        // OkHttp's Android variant may print a warning to standard error in a unit-test JVM, so the capture need not be empty.
        assertFalse(captured.toString("UTF-8").contains(CANARY), "standard output and error hold the canary")
        servers.assertBReceivedNothing()
    }
}
