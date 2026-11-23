package dev.octave.artwork.load

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

// T3-39 item 7 (docs/specs/T3-39.md, "Decode cost and recycled cards"): the median time of 1 000 decodes of a 9x9 hash
// (the costliest shape) and of a 4x5 hash (a recorded Jellyfin hash) on the JVM, printed for the spec's
// Implementation record. It asserts nothing about time, only that every decode gives a preview.
class BlurHashCostTest {
    private val nine =
        "|e8h|XT1u;25T[v#2{U+wr3:Vvxi4zWmyZ5qXdzQ6hYU#H7YZL\$88PaC\$~9Gb3%?A7b^*%A}c-+tB=dx,kC\$eo-bDsff.SEjgW:JFahN;AGRiE=1HIj5=[I9j{?+J0k:@vJ@lz[mK*mq]dLunh^UMloY_LNcpP{COTqG|3"
    private val jellyfin = "diE|rGDNI9tmPpMca0tSO@xFs9R%xuofWARiNGkWWVso"

    private fun medianMicros(hash: String): Double {
        repeat(200) { BlurHash.decode(hash) }
        val times = LongArray(1_000) {
            val start = System.nanoTime()
            val pixels = BlurHash.decode(hash)
            val took = System.nanoTime() - start
            assertEquals(1024, pixels?.size)
            took
        }
        times.sort()
        return (times[499] + times[500]) / 2.0 / 1_000.0
    }

    @Test
    fun the_median_decode_time_is_recorded() {
        println("T3-39 decode median, 1 000 decodes on the JVM: 9x9 ${"%.1f".format(medianMicros(nine))} us, 4x5 ${"%.1f".format(medianMicros(jellyfin))} us")
    }
}
