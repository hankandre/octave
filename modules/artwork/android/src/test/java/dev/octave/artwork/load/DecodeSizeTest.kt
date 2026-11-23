package dev.octave.artwork.load

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// T3-11 acceptance item 3, the decode half (docs/specs/T3-11.md, "The loader"): Jellyscale ignores maxWidth, so the
// decoder samples a large answer down to the drawn width.
//
// The contract frozen here (package dev.octave.artwork.load, plain Kotlin):
// - DecodeSize.sampleFor(sourceWidth: Int, sourceHeight: Int, width: Int): Int? is the largest power of two that keeps
//   sourceWidth / sample at or above `width`, and 1 when the source is no wider than `width` (never an upscale).
// - It answers null for a source the decoder refuses: a side of 0 or less, or a side over 8192 px.
class DecodeSizeTest {
    @Test
    fun a_3840_answer_for_a_request_of_248_decodes_at_480() {
        assertEquals(8, DecodeSize.sampleFor(3840, 2160, 248))
        assertEquals(480, 3840 / 8)
    }

    @Test
    fun the_sample_keeps_the_decoded_width_at_or_above_the_request() {
        assertEquals(1, DecodeSize.sampleFor(248, 372, 248), "exactly the drawn width")
        assertEquals(1, DecodeSize.sampleFor(100, 150, 248), "a smaller source is never scaled up")
        assertEquals(2, DecodeSize.sampleFor(496, 744, 248))
        assertEquals(2, DecodeSize.sampleFor(980, 1470, 248), "980 / 4 is 245, below 248")
        assertEquals(4, DecodeSize.sampleFor(1000, 1500, 248))
        assertEquals(4, DecodeSize.sampleFor(2000, 3000, 400))
        assertEquals(1, DecodeSize.sampleFor(1920, 1080, 1920))
        assertEquals(2, DecodeSize.sampleFor(3840, 2160, 1920))
    }

    @Test
    fun every_sample_is_the_largest_power_of_two_that_holds() {
        for (width in listOf(1, 248, 400, 416, 1920)) {
            for (source in 1..8192 step 37) {
                val sample = DecodeSize.sampleFor(source, source, width)
                assertNotNull(sample, "source $source")
                sample!!
                assertTrue(sample >= 1 && Integer.bitCount(sample) == 1, "a power of two for $source at $width")
                if (source >= width) {
                    assertTrue(source / sample >= width, "$source / $sample keeps $width")
                    assertTrue(source / (sample * 2) < width, "$source / ${sample * 2} would not keep $width")
                } else {
                    assertEquals(1, sample, "no upscale for $source at $width")
                }
            }
        }
    }

    @Test
    fun a_source_with_a_zero_side_or_a_side_over_8192_is_refused() {
        assertNull(DecodeSize.sampleFor(0, 100, 248))
        assertNull(DecodeSize.sampleFor(100, 0, 248))
        assertNull(DecodeSize.sampleFor(-1, 100, 248))
        assertNull(DecodeSize.sampleFor(8193, 100, 248))
        assertNull(DecodeSize.sampleFor(100, 8193, 248))
        assertNotNull(DecodeSize.sampleFor(8192, 8192, 248))
    }
}
