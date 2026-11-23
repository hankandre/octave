package dev.octave.artwork.load

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import kotlin.math.abs

// T3-39 acceptance item 5 (docs/specs/T3-39.md, "Dependencies" and Test plan): the decoder is the module's own code,
// held to packages/core/tests/fixtures/blurhash-vectors.json, which a Swift decoder can be held to as well. Every decode
// vector's pixels ([x, y, r, g, b] of a 32x32 decode) match within +-1 per channel with alpha 255, and every refuse
// vector decodes to null. BlurHash.decode answers ARGB ints, row by row (index y * 32 + x).
//
// The module takes no JSON library (its Gradle file is held by PreviewSourceTest), so the file is read with the small
// reader below.
class BlurHashVectorsTest {
    private val repoRoot = File(checkNotNull(System.getProperty("octave.repoRoot")) { "system property octave.repoRoot is not set" })

    @Suppress("UNCHECKED_CAST")
    private fun vectors(): Map<String, Any?> =
        Json(File(repoRoot, "packages/core/tests/fixtures/blurhash-vectors.json").readText()).document() as Map<String, Any?>

    @Suppress("UNCHECKED_CAST")
    private fun entries(name: String): List<Map<String, Any?>> = vectors()[name] as List<Map<String, Any?>>

    @Test
    fun the_file_states_the_size_and_the_bound() {
        val file = vectors()
        assertEquals(32L, file["size"])
        assertEquals(166L, file["maxLength"])
        assertEquals(BlurHash.SIZE.toLong(), file["size"])
        assertEquals(BlurHash.MAX_LENGTH.toLong(), file["maxLength"])
        assertTrue(entries("decode").size >= 6, "at least six decode vectors")
        assertTrue(entries("refuse").size >= 9, "at least nine refuse vectors")
        assertTrue(entries("decode").any { (it["hash"] as String).length == 166 }, "a 166-character decode vector")
    }

    @Test
    fun every_decode_vector_matches_within_one_per_channel() {
        for (vector in entries("decode")) {
            val hash = vector["hash"] as String
            val pixels = BlurHash.decode(hash)
            assertNotNull(pixels, "$hash is accepted")
            assertEquals(1024, pixels!!.size, "$hash decodes to 32 x 32")
            @Suppress("UNCHECKED_CAST")
            val expected = vector["pixels"] as List<List<Long>>
            assertTrue(expected.isNotEmpty(), "$hash has expected pixels")
            for ((x, y, r, g, b) in expected.map { point -> point.map { it.toInt() } }) {
                val argb = pixels[y * 32 + x]
                val actual = listOf(argb ushr 16 and 0xFF, argb ushr 8 and 0xFF, argb and 0xFF)
                assertEquals(0xFF, argb ushr 24, "$hash at ($x, $y): alpha")
                for ((channel, pair) in listOf("r", "g", "b").zip(actual.zip(listOf(r, g, b)))) {
                    assertTrue(abs(pair.first - pair.second) <= 1, "$hash at ($x, $y): $channel is ${pair.first}, expected ${pair.second} +-1")
                }
            }
        }
    }

    @Test
    fun every_refuse_vector_is_refused() {
        for (vector in entries("refuse")) {
            val hash = vector["hash"] as String
            assertNull(BlurHash.decode(hash), "refused: ${vector["why"]}")
        }
    }

    // A strict reader for the JSON this file holds: objects, arrays, strings, integers, true, false and null.
    private class Json(private val text: String) {
        private var at = 0

        fun document(): Any? {
            val value = value()
            space()
            check(at == text.length) { "trailing text at $at" }
            return value
        }

        private fun space() {
            while (at < text.length && text[at] in " \t\r\n") at += 1
        }

        private fun value(): Any? {
            space()
            check(at < text.length) { "unexpected end" }
            return when (val c = text[at]) {
                '{' -> obj()
                '[' -> array()
                '"' -> string()
                't' -> literal("true", true)
                'f' -> literal("false", false)
                'n' -> literal("null", null)
                else -> if (c == '-' || c.isDigit()) number() else error("unexpected '$c' at $at")
            }
        }

        private fun literal(word: String, value: Any?): Any? {
            check(text.startsWith(word, at)) { "bad literal at $at" }
            at += word.length
            return value
        }

        private fun number(): Long {
            val start = at
            if (text[at] == '-') at += 1
            while (at < text.length && text[at].isDigit()) at += 1
            check(at < text.length && text[at] !in ".eE") { "only integers are expected, at $start" }
            return text.substring(start, at).toLong()
        }

        private fun string(): String {
            at += 1
            val out = StringBuilder()
            while (true) {
                check(at < text.length) { "unterminated string" }
                val c = text[at++]
                when (c) {
                    '"' -> return out.toString()
                    '\\' -> {
                        when (val e = text[at++]) {
                            '"', '\\', '/' -> out.append(e)
                            'b' -> out.append('\b')
                            'f' -> out.append('\u000c')
                            'n' -> out.append('\n')
                            'r' -> out.append('\r')
                            't' -> out.append('\t')
                            'u' -> {
                                out.append(text.substring(at, at + 4).toInt(16).toChar())
                                at += 4
                            }
                            else -> error("bad escape at $at")
                        }
                    }
                    else -> out.append(c)
                }
            }
        }

        private fun array(): List<Any?> {
            at += 1
            val out = mutableListOf<Any?>()
            space()
            if (text[at] == ']') {
                at += 1
                return out
            }
            while (true) {
                out += value()
                space()
                when (text[at++]) {
                    ',' -> continue
                    ']' -> return out
                    else -> error("bad array at ${at - 1}")
                }
            }
        }

        private fun obj(): Map<String, Any?> {
            at += 1
            val out = linkedMapOf<String, Any?>()
            space()
            if (text[at] == '}') {
                at += 1
                return out
            }
            while (true) {
                space()
                check(text[at] == '"') { "a key at $at" }
                val key = string()
                space()
                check(text[at++] == ':') { "a colon at ${at - 1}" }
                out[key] = value()
                space()
                when (text[at++]) {
                    ',' -> continue
                    '}' -> return out
                    else -> error("bad object at ${at - 1}")
                }
            }
        }
    }
}
