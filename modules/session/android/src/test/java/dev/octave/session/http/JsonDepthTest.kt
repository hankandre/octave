package dev.octave.session.http

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// T3-25 (docs/specs/T3-25.md, "The scan"): JsonDepth.exceeds as a pure function. Unfrozen; the frozen AnswerDepthTest
// shows the bound through the one client.
class JsonDepthTest {
    private fun arrays(n: Int): String = "[".repeat(n) + "]".repeat(n)

    @Test
    fun the_bound_is_64() = assertEquals(64, JsonDepth.MAX)

    @Test
    fun depth_0_1_and_64_pass_and_65_exceeds() {
        assertFalse(JsonDepth.exceeds("1"), "a scalar")
        assertFalse(JsonDepth.exceeds("[]"), "depth 1")
        assertFalse(JsonDepth.exceeds("{\"a\":[1]}"), "depth 2")
        assertFalse(JsonDepth.exceeds(arrays(64)), "depth 64")
        assertTrue(JsonDepth.exceeds(arrays(65)), "depth 65")
        assertTrue(JsonDepth.exceeds("{\"a\":".repeat(65) + "1" + "}".repeat(65)), "objects, depth 65")
    }

    @Test
    fun leading_whitespace_and_a_byte_order_mark_are_skipped() {
        for (lead in listOf(" ", "\t", "\n", "\r", "\u000b", "\u0000", "﻿", " ﻿\t")) {
            assertTrue(JsonDepth.exceeds(lead + arrays(65)), "lead ${lead.map { it.code }}")
            assertFalse(JsonDepth.exceeds(lead + arrays(64)), "lead ${lead.map { it.code }}")
        }
    }

    @Test
    fun a_text_that_does_not_begin_with_a_bracket_is_not_scanned() {
        for (start in listOf("<", "\"", "1", "a", "]", "}")) {
            assertFalse(JsonDepth.exceeds(start + "[".repeat(100)), "begins with $start")
        }
    }

    @Test
    fun brackets_inside_strings_do_not_count() {
        assertFalse(JsonDepth.exceeds("[\"" + "[{".repeat(500) + "\"]"))
        assertFalse(JsonDepth.exceeds("{\"" + "[".repeat(100) + "\":1}"), "in a key")
    }

    @Test
    fun an_escaped_quote_stays_in_the_string_and_an_escaped_backslash_ends_it() {
        assertFalse(JsonDepth.exceeds("[\"a\\\"" + "[".repeat(100) + "\"]"), "\\\" does not end the string")
        assertTrue(JsonDepth.exceeds("[\"a\\\\\"," + arrays(64) + "]"), "\\\\\" ends the string")
    }

    @Test
    fun unclosed_and_unmatched_text() {
        assertTrue(JsonDepth.exceeds("[".repeat(65) + "not json"), "65 unclosed")
        assertFalse(JsonDepth.exceeds("[".repeat(64)), "64 unclosed")
        assertFalse(JsonDepth.exceeds("[" + "]".repeat(10) + "[".repeat(64)), "closers at depth 0 do not go below 0")
        assertTrue(JsonDepth.exceeds("[" + "]".repeat(10) + "[".repeat(65)))
        assertFalse(JsonDepth.exceeds("[" + List(100) { "[]" }.joinToString(",") + "]"), "siblings count down")
        assertFalse(JsonDepth.exceeds("[\"" + "[".repeat(100)), "an unclosed string")
    }

    @Test
    fun an_empty_or_blank_text_does_not_exceed() {
        assertFalse(JsonDepth.exceeds(""))
        assertFalse(JsonDepth.exceeds("   "))
    }

    @Test
    fun a_custom_max() {
        assertFalse(JsonDepth.exceeds("[[]]", max = 2))
        assertTrue(JsonDepth.exceeds("[[[]]]", max = 2))
        assertTrue(JsonDepth.exceeds("[]", max = 0))
    }
}
