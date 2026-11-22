package dev.octave.session.http

import dev.octave.session.http.TransportTestSupport.TOKEN
import dev.octave.session.http.TransportTestSupport.assertNoToken
import dev.octave.session.http.TransportTestSupport.json
import dev.octave.session.http.TransportTestSupport.sessionRequest
import dev.octave.session.http.TransportTestSupport.signIn
import dev.octave.session.http.TransportTestSupport.tokenlessRequest
import kotlinx.serialization.json.Json
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.opentest4j.AssertionFailedError

// T3-16 item 2 (gate: met; docs/specs/T3-16.md, "Named pins"): before a response body crosses to JavaScript, every
// occurrence of the session's token, as written and percent-encoded, is replaced with a fixed marker. A PlaybackInfo
// answer whose subtitle DeliveryUrl and TranscodingUrl carry the token crosses without it.
//
// The filter-off control is the pre-sign-in path, where no session exists and the filter has no token to remove (the
// spec's decision; no off-switch is added to main source): the same answer crosses with the token, and assertNoToken
// throws on it. The session half asserts equality with a text that holds [redacted] in each place, so a request that
// skipped the filter fails it too.
class EchoedTokenTest {
    private val server = PathServer()

    @AfterEach
    fun close() = server.close()

    private val forms = TokenStrip.forms(TOKEN)

    // forms: as written, percent-encoded upper-case hex, lower-case hex, query-encoded (TokenStripTest pins the list).
    private fun playbackInfo(token: List<String>): String =
        """{"MediaSources":[{"Id":"src-1","MediaStreams":[{"Type":"Subtitle","Index":2,"DeliveryMethod":"External",""" +
            """"DeliveryUrl":"/Videos/a/src-1/Subtitles/2/0/Stream.srt?ApiKey=${token[0]}"}],""" +
            """"TranscodingUrl":"/videos/a/master.m3u8?MediaSourceId=src-1&ApiKey=${token[1]}",""" +
            """"Path":"/media/${token[2]}.mkv","Name":"x${token[3]}y"}],"PlaySessionId":"ps-1"}"""

    @Test
    fun an_echoed_token_is_removed_from_response_bodies() {
        assertEquals(4, forms.size, "the token's four forms")
        val answer = playbackInfo(forms)
        val redacted = playbackInfo(List(4) { "[redacted]" })

        val session = signIn(server)
        try {
            server.answer("/Items/a/PlaybackInfo") { json(200, answer) }
            val result = sessionRequest(session, "POST", "/Items/a/PlaybackInfo", mapOf("body" to "{}"))
            assertEquals(200, result["status"])
            val body = result["body"] as String
            assertNoToken(body)
            assertEquals(redacted, body, "each form is replaced with the marker and nothing else changes")
        } finally {
            SessionRegistry.close(SessionId.parse(session)!!)
        }

        // Filter off: the pre-sign-in call has no session, so the filter has no token, and the body crosses unchanged.
        server.answer("/System/Info/Public") { json(200, answer) }
        val unfiltered = tokenlessRequest(server.origin, "GET", "/System/Info/Public")
        assertEquals(200, unfiltered["status"])
        assertEquals(answer, unfiltered["body"], "an unfiltered crossing keeps the token")
        assertThrows(AssertionFailedError::class.java) { assertNoToken(unfiltered["body"] as String) }
        assertThrows(AssertionFailedError::class.java) {
            assertNoToken(TokenStrip.strip(Json.parseToJsonElement(answer), emptyList()).toString())
        }
    }
}
