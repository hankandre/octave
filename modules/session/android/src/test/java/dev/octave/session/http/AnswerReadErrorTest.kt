package dev.octave.session.http

import dev.octave.session.http.TestSupport.repoFile
import dev.octave.session.http.TransportTestSupport.json
import dev.octave.session.http.TransportTestSupport.tokenlessRequest
import okhttp3.Call
import okhttp3.MediaType
import okhttp3.Request
import okhttp3.ResponseBody
import okio.Buffer
import okio.BufferedSource
import okio.Source
import okio.Timeout
import okio.buffer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.fail
import org.junit.jupiter.api.Test
import java.lang.reflect.InvocationTargetException

// T3-25 review fix (item 2, the first medium): the frozen ParserErrorCodeTest raises the two errors in the Dns lookup
// and the argument maps, not while an answer is read or parsed. These cases guard the read and the parse against a
// later catch that would swallow a StackOverflowError or an OutOfMemoryError and let the answer cross as
// { status: 200, body: null }.
//
// - The read: readLimited, called by reflection, with a body whose source raises the error inside source.request,
//   the real okio read. The same error object leaves it, and TransportCodes.of maps it to unexpected-response.
// - The parse: no bytes can raise an Error there once the depth bound exists, so a source scan holds the rule
//   instead: SessionTransport.kt catches Throwable only in outcome, catches no Error type anywhere, and send,
//   readLimited, parse and strictJson use no runCatching.
// - Spec-check note 2, on the JVM only: a literal of a million digits goes through the regex in strictJson and the
//   one client without a StackOverflowError. Android's regex engine is not checked here (unverified).
//
// What this does not show: an error raised in the read or the parse through the one client. No seam reaches those
// steps, and this task adds none (docs/specs/T3-25.md, "Decisions").
class AnswerReadErrorTest {
    private val server = PathServer()

    @AfterEach
    fun cleanUp() {
        ResolverTestSupport.emptyPool()
        server.close()
    }

    // A source whose every read raises `error`.
    private class RaisingSource(private val error: Throwable) : Source {
        override fun read(sink: Buffer, byteCount: Long): Long = throw error

        override fun timeout(): Timeout = Timeout.NONE

        override fun close() = Unit
    }

    // A body of unknown length, so readLimited goes past the declared-length check to the read.
    private class RaisingBody(error: Throwable) : ResponseBody() {
        private val source = RaisingSource(error).buffer()

        override fun contentType(): MediaType? = null

        override fun contentLength(): Long = -1

        override fun source(): BufferedSource = source
    }

    // Calls SessionTransport.readLimited with an unsent call and returns what it threw, or fails if it returned.
    private fun readLimitedThrows(body: ResponseBody): Throwable {
        val method = SessionTransport::class.java.declaredMethods.singleOrNull { it.name == "readLimited" }
            ?: fail<Nothing>("SessionTransport has one readLimited")
        method.isAccessible = true
        val call: Call = OctaveHttp.client.newCall(Request.Builder().url("http://127.0.0.1:9/").build())
        try {
            method.invoke(TransportTestSupport.transport, call, body, ResponseCaps.TOKENLESS)
        } catch (error: InvocationTargetException) {
            return error.targetException
        } finally {
            call.cancel()
        }
        fail<Nothing>("readLimited returned an answer for a body whose read raised an error")
    }

    @Test
    fun an_error_raised_while_the_body_is_read_leaves_the_read_unchanged_and_maps_to_unexpected_response() {
        val errors = listOf(StackOverflowError(), OutOfMemoryError("http://media.example:8096/Items?api_key=made-up-0001"))
        for (error in errors) {
            val name = error.javaClass.simpleName
            val thrown = readLimitedThrows(RaisingBody(error))
            assertSame(error, thrown, "$name leaves readLimited as the same object, not UnusableAnswer or another")
            assertEquals(TransportCodes.UNEXPECTED_RESPONSE, TransportCodes.of(thrown), "$name maps to unexpected-response")
        }
    }

    @Test
    fun the_scan_catches_each_way_an_error_could_be_swallowed() {
        val outcome = "private inline fun outcome(block: () -> Map<String, Any?>): Map<String, Any?> = try {\n" +
            "    block()\n} catch (error: Throwable) {\n    mapOf(\"error\" to TransportCodes.of(error))\n}\n"
        val swallowing = mapOf(
            "a Throwable catch in parse" to "private fun parse(bytes: ByteArray): JsonElement? {\n" +
                "    val element = try { x() } catch (_: Throwable) { return null }\n}\n",
            "an Error catch in readLimited" to "private fun readLimited(): ByteArray = try { y() } catch (e: Error) { ByteArray(0) }\n",
            "a StackOverflowError catch" to "fun f() = try { g() } catch (e: StackOverflowError) { null }\n",
            "a qualified OutOfMemoryError catch" to "fun f() = try { g() } catch (e : java.lang.OutOfMemoryError) { null }\n",
            "a VirtualMachineError catch" to "fun f() = try { g() } catch (e: VirtualMachineError) { null }\n",
            "runCatching in parse" to "private fun parse(bytes: ByteArray): JsonElement? = runCatching { g() }.getOrNull()\n",
            "runCatching in strictJson" to "private fun strictJson(e: JsonElement): Boolean = runCatching { h(e) }.getOrDefault(false)\n",
        )
        for ((name, text) in swallowing) {
            assertTrue(problems(outcome + text).isNotEmpty(), "the scan catches $name")
        }
        assertTrue(problems("fun f() = 1\n").isNotEmpty(), "the scan needs the one Throwable catch in outcome")
        assertEquals(emptyList<String>(), problems(outcome + "fun f() = try { g() } catch (_: Exception) { null }\n"))
    }

    @Test
    fun session_transport_catches_throwable_only_in_outcome_and_no_error_type_anywhere() {
        val file = repoFile("modules/session/android/src/main/java/dev/octave/session/http/SessionTransport.kt")
        val text = file.readText()
        for (name in ANSWER_PATH) assertTrue(text.contains("fun $name("), "SessionTransport.kt still has $name, so the scan reads it")
        assertEquals(emptyList<String>(), problems(text))
    }

    @Test
    fun a_literal_of_a_million_digits_is_parsed_without_a_stack_overflow() {
        val digits = "1" + "0".repeat(999_999)
        server.answer("/System/Info/Public") { json(200, digits) }
        val result = tokenlessRequest(server.origin, "GET", "/System/Info/Public")
        assertEquals(200, result["status"], "the answer crosses with its status, not as an error: ${result["error"]}")
        assertEquals(digits, result["body"], "the literal crosses whole")
    }

    private fun problems(source: String): List<String> {
        val code = source.lines().joinToString("\n") { it.substringBefore("//") }
        val found = mutableListOf<String>()
        for (name in ANSWER_PATH) {
            val start = code.indexOf("fun $name(")
            if (start < 0) continue
            val end = NEXT_FUN.find(code, start + 1)?.range?.first ?: code.length
            if (code.substring(start, end).contains("runCatching")) found.add("runCatching in $name")
        }
        val outcomeStart = code.indexOf("fun outcome(")
        val outcomeEnd = if (outcomeStart < 0) -1 else NEXT_FUN.find(code, outcomeStart + 1)?.range?.first ?: code.length
        var inOutcome = 0
        for (match in CATCH.findAll(code)) {
            val type = match.groupValues[1].substringAfterLast('.')
            val at = match.range.first
            when {
                type == "Throwable" && at in outcomeStart..outcomeEnd -> inOutcome += 1
                type == "Throwable" -> found.add("Throwable caught outside outcome at offset $at")
                type.endsWith("Error") -> found.add("$type caught at offset $at")
            }
        }
        if (inOutcome != 1) found.add("outcome holds $inOutcome Throwable catches, not 1")
        return found
    }

    private companion object {
        val CATCH = Regex("""catch\s*\(\s*\w+\s*:\s*([\w.]+)\s*\)""")
        // The functions an answer passes through after the call returns. runCatching elsewhere (the check of the
        // caller's own request body) is not on the answer path.
        val ANSWER_PATH = listOf("send", "readLimited", "parse", "strictJson")
        val NEXT_FUN = Regex("""\n\s*(?:private |internal |public )?(?:inline )?fun """)
    }
}
