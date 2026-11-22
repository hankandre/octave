package dev.octave.session.http

import dev.octave.session.http.TransportTestSupport.TOKEN
import dev.octave.session.http.TransportTestSupport.assertNoToken
import dev.octave.session.http.TransportTestSupport.json
import dev.octave.session.http.TransportTestSupport.sessionRequest
import dev.octave.session.http.TransportTestSupport.signIn
import kotlinx.serialization.json.Json
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.opentest4j.AssertionFailedError

// T3-05: a session's token is removed from every answer before it crosses (decision 0005, "The seam"), as written,
// percent-encoded in either hex case and query-encoded, in strings and keys, after the parse, so a JSON escape cannot
// hide it. The named filter tests are T3-16's (an_echoed_token_is_removed_from_response_bodies).
class TokenStripTest {
    private val server = PathServer()

    @AfterEach
    fun close() = server.close()

    private val forms = TokenStrip.forms(TOKEN)

    @Test
    fun the_forms_are_the_reference_adapter_s() {
        assertEquals(
            listOf(TOKEN, "tok%2F3f9a%2Bb7c%3D0d1e%20%C3%BC", "tok%2f3f9a%2bb7c%3d0d1e%20%c3%bc", "tok%2F3f9a%2Bb7c%3D0d1e+%C3%BC"),
            forms,
        )
        assertEquals(emptyList<String>(), TokenStrip.forms(""))
    }

    @Test
    fun every_form_is_removed_from_strings_and_keys_at_any_depth() {
        val body = Json.parseToJsonElement(
            """{"a":"${forms[0]}","b":["x${forms[1]}y",{"c":"${forms[2]}"}],"${forms[3]}":1,"n":3,"t":true,"z":null}""",
        )
        val text = TokenStrip.strip(body, forms).toString()
        assertNoToken(text)
        assertEquals("""{"a":"[redacted]","b":["x[redacted]y",{"c":"[redacted]"}],"[redacted]":1,"n":3,"t":true,"z":null}""", text)
    }

    @Test
    fun a_number_that_holds_the_token_is_replaced() {
        val digits = TokenStrip.forms("0123456789")
        assertEquals("""{"n":"[redacted]","m":7}""", TokenStrip.strip(Json.parseToJsonElement("""{"n":10123456789,"m":7}"""), digits).toString())
    }

    @Test
    fun a_json_escape_does_not_hide_the_token() {
        val escaped = TOKEN.map { "\\u%04x".format(it.code) }.joinToString("")
        val text = TokenStrip.strip(Json.parseToJsonElement("""{"DeliveryUrl":"/Stream?ApiKey=$escaped"}"""), forms).toString()
        assertNoToken(text)
        assertEquals("""{"DeliveryUrl":"/Stream?ApiKey=[redacted]"}""", text)
    }

    @Test
    fun the_assertion_fails_on_a_body_that_keeps_the_token() {
        for (form in forms) assertThrows(AssertionFailedError::class.java) { assertNoToken("""{"Url":"/x?ApiKey=$form"}""") }
        val unfiltered = Json.parseToJsonElement("""{"Url":"${forms[1]}"}""").toString()
        assertThrows(AssertionFailedError::class.java) { assertNoToken(unfiltered) }
    }

    @Test
    fun an_echoed_token_is_gone_from_a_crossing_body() {
        val session = signIn(server)
        server.answer("/Items/a/PlaybackInfo") {
            json(200, """{"MediaSources":[{"TranscodingUrl":"/v.m3u8?ApiKey=${forms[1]}","Path":"${forms[0]}"}],"${forms[3]}":"k"}""")
        }
        val result = sessionRequest(session, "POST", "/Items/a/PlaybackInfo", mapOf("body" to "{}"))
        assertEquals(200, result["status"])
        assertNoToken(result["body"] as String)
        assertEquals("""{"MediaSources":[{"TranscodingUrl":"/v.m3u8?ApiKey=[redacted]","Path":"[redacted]"}],"[redacted]":"k"}""", result["body"])
        SessionRegistry.close(SessionId.parse(session)!!)
    }
}
