package dev.octave.artwork.load

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.Random

// T3-39 acceptance items 4 and 1 (docs/specs/T3-39.md, "The native decoder"): the BlurHash is validated and decoded by
// the module's own plain-Kotlin decoder, and a hash that is malformed or longer than the bound is refused. Item 1's
// 32x32 preview is held here as 1 024 ints; BitmapPreviews.kt, which wraps them in a Bitmap, is Android code the JVM
// tests cannot run, so only the device screenshots cover it.
//
// The contract frozen here (package dev.octave.artwork.load, no Android import):
// - object BlurHash { const val MAX_LENGTH = 166; const val SIZE = 32; fun decode(hash: String): IntArray? }.
// - decode answers SIZE x SIZE = 1 024 ARGB ints, row by row (index y * 32 + x), each with alpha 255, whatever the
//   hash's component count, or null for a refused hash. It never throws.
// - It refuses: an empty string; fewer than 6 characters; more than MAX_LENGTH; any character outside the 83-character
//   alphabet 0-9A-Za-z#$%*+,-.:;=?@[]^_{|}~ (non-ASCII included); a length that is not 4 + 2 * numX * numY for the
//   size flag; a DC value above 0xFFFFFF; an AC value above 6858.
class BlurHashTest {
    private val alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#\$%*+,-.:;=?@[]^_{|}~"

    // The reference README's example (4x3) and a 9x9 hash of 166 characters, both in blurhash-vectors.json.
    private val readme = "LEHV6nWB2yk8pyo0adR*.7kCMdnj"
    private val nine =
        "|e8h|XT1u;25T[v#2{U+wr3:Vvxi4zWmyZ5qXdzQ6hYU#H7YZL\$88PaC\$~9Gb3%?A7b^*%A}c-+tB=dx,kC\$eo-bDsff.SEjgW:JFahN;AGRiE=1HIj5=[I9j{?+J0k:@vJ@lz[mK*mq]dLunh^UMloY_LNcpP{COTqG|3"

    private fun encode83(value: Int, length: Int): String {
        val out = StringBuilder()
        var rest = value
        repeat(length) {
            out.insert(0, alphabet[rest % 83])
            rest /= 83
        }
        return out.toString()
    }

    private fun replaceAt(hash: String, index: Int, with: String): String = hash.substring(0, index) + with + hash.substring(index + 1)

    private fun assertPreview(pixels: IntArray?, what: String) {
        assertNotNull(pixels, "$what is accepted")
        assertEquals(1024, pixels!!.size, "$what decodes to 32 x 32 ints")
        assertTrue(pixels.all { it ushr 24 == 0xFF }, "$what has alpha 255 on every pixel")
    }

    @Test
    fun the_bound_and_the_size_are_the_formats_own() {
        assertEquals(166, BlurHash.MAX_LENGTH)
        assertEquals(32, BlurHash.SIZE)
        assertEquals(alphabet.length, alphabet.toSet().size)
        assertEquals(83, alphabet.length)
        assertEquals(166, nine.length)
    }

    @Test
    fun valid_hashes_of_every_size_decode_to_32_by_32() {
        assertPreview(BlurHash.decode("000000"), "a 1x1 hash")
        assertPreview(BlurHash.decode(readme), "the README's 4x3 hash")
        assertPreview(BlurHash.decode(nine), "a 166-character 9x9 hash")
        assertPreview(BlurHash.decode("diE|rGDNI9tmPpMca0tSO@xFs9R%xuofWARiNGkWWVso"), "a fixture's 4x5 hash")
    }

    @Test
    fun a_1x1_hash_is_its_dc_colour_on_every_pixel() {
        val pixels = BlurHash.decode("00" + encode83(0x336699, 4))
        assertPreview(pixels, "a 1x1 hash")
        assertTrue(pixels!!.all { it == 0xFF336699.toInt() }, "every pixel is 0xFF336699")
    }

    @Test
    fun an_empty_hash_is_refused() {
        assertNull(BlurHash.decode(""))
    }

    @Test
    fun fewer_than_6_characters_are_refused() {
        for (hash in listOf("0", "00", "000", "0000", "00000")) assertNull(BlurHash.decode(hash), hash)
    }

    @Test
    fun more_than_166_characters_are_refused() {
        assertNull(BlurHash.decode(nine + "0"), "167 characters")
        assertNull(BlurHash.decode(nine + "00"), "168 characters")
        assertNull(BlurHash.decode(nine.repeat(61).take(10_000)), "10 000 characters")
        assertNull(BlurHash.decode("|" + "0".repeat(9_999)), "10 000 characters behind a 9x9 size flag")
    }

    @Test
    fun a_character_outside_the_alphabet_is_refused() {
        for (bad in listOf(" ", "é", "\"", "/", "\\", "'", "!", "&", "<", "\t", "\n", "\u0000", " ", "０")) {
            val hash = replaceAt(readme, 10, bad)
            assertEquals(readme.length, hash.length, "the plant keeps the length")
            assertNull(BlurHash.decode(hash), "a hash holding U+%04X".format(bad[0].code))
        }
        assertNull(BlurHash.decode(replaceAt(readme, 0, "é")), "a non-ASCII size flag")
        assertNull(BlurHash.decode(readme.substring(0, 26) + "😀"), "a character outside the BMP")
        assertNull(BlurHash.decode(replaceAt(nine, 165, " ")), "a space as the last character of a 9x9 hash")
    }

    @Test
    fun a_length_that_does_not_match_the_size_flag_is_refused() {
        assertNull(BlurHash.decode(readme + "00"), "30 characters where 4x3 asks for 28")
        assertNull(BlurHash.decode(readme.dropLast(2)), "26 characters where 4x3 asks for 28")
        assertNull(BlurHash.decode(readme + "0"), "29 characters")
        assertNull(BlurHash.decode("0000000"), "7 characters where 1x1 asks for 6")
        assertNull(BlurHash.decode("1" + readme.substring(1)), "a 2x1 flag on a 28-character hash")
    }

    @Test
    fun a_dc_value_above_0xffffff_is_refused() {
        assertPreview(BlurHash.decode("00" + encode83(0xFFFFFF, 4)), "a DC of 0xFFFFFF")
        assertNull(BlurHash.decode("00" + encode83(0x1000000, 4)), "a DC of 0xFFFFFF + 1")
        assertNull(BlurHash.decode("00~~~~"), "the largest four-character DC")
    }

    @Test
    fun an_ac_value_above_6858_is_refused() {
        assertPreview(BlurHash.decode("10" + encode83(0, 4) + encode83(6858, 2)), "an AC of 6858")
        assertNull(BlurHash.decode("10" + encode83(0, 4) + encode83(6859, 2)), "an AC of 6859")
        assertNull(BlurHash.decode("10" + encode83(0, 4) + "~~"), "the largest two-character AC")
        assertNull(BlurHash.decode(nine.substring(0, 164) + "~~"), "the last AC of a 9x9 hash above 6858")
    }

    @Test
    fun random_strings_give_null_or_a_preview_and_never_throw() {
        val random = Random(39L)
        val outside = " \"'\\/!&<>()`é\u0000\n\t "
        var accepted = 0
        repeat(2_000) { n ->
            val length = random.nextInt(301)
            val text = if (n % 2 == 0) {
                // Free text: mostly alphabet characters, some outside it.
                buildString { repeat(length) { append(if (random.nextInt(10) == 0) outside[random.nextInt(outside.length)] else alphabet[random.nextInt(83)]) } }
            } else {
                // Shaped: a size flag and exactly the length it asks for, with any alphabet characters after it.
                val flag = random.nextInt(81)
                val size = 4 + 2 * (flag % 9 + 1) * (flag / 9 + 1)
                alphabet[flag].toString() + buildString { repeat(size - 1) { append(alphabet[random.nextInt(83)]) } }
            }
            val pixels = try {
                BlurHash.decode(text)
            } catch (thrown: Throwable) {
                throw AssertionError("decode threw ${thrown::class.java.name} on a ${text.length}-character string (case $n)", thrown)
            }
            if (pixels != null) {
                accepted += 1
                assertEquals(1024, pixels.size, "case $n decodes to 32 x 32 ints")
                assertTrue(pixels.all { it ushr 24 == 0xFF }, "case $n has alpha 255")
            }
        }
        assertTrue(accepted > 0, "some random shaped hashes are accepted, so the decode path runs")
    }
}
