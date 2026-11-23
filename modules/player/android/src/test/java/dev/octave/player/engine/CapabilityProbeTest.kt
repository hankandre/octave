package dev.octave.player.engine

import dev.octave.player.seam.Capabilities
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// T8-07 item 5 (docs/specs/T8-07.md, "Running it" and D7; Test plan 3): CapabilityProbe(read).probe() is "cannot tell"
// (Capabilities.Failed) when the reader throws anything, answers null (no context, a destroyed module), or reports no
// video decoder; otherwise it is CapabilityMap's answer. It reads the platform afresh on every call.
class CapabilityProbeTest {
    private val good = PlatformReport(
        video = listOf(PlatformVideoDecoder(codec = "h264", hardware = false, profiles = listOf(PlatformProfile(name = "High", bitDepth = null)), maxWidth = 4096, maxHeight = 4096)),
        audio = listOf("aac"),
        hdr = emptyList(),
        passthrough = emptyList(),
    )

    @Test
    fun a_reader_that_throws_is_failed() {
        assertEquals(Capabilities.Failed, CapabilityProbe { throw IllegalStateException("codec list") }.probe())
        assertEquals(Capabilities.Failed, CapabilityProbe { throw SecurityException("display") }.probe())
        assertEquals(Capabilities.Failed, CapabilityProbe { throw NoSuchMethodError("an older platform") }.probe())
    }

    @Test
    fun a_null_report_is_failed() {
        assertEquals(Capabilities.Failed, CapabilityProbe { null }.probe())
    }

    @Test
    fun a_report_with_no_video_decoder_is_failed() {
        assertEquals(Capabilities.Failed, CapabilityProbe { PlatformReport(video = emptyList(), audio = listOf("aac"), hdr = emptyList(), passthrough = listOf("ac3")) }.probe())
    }

    @Test
    fun a_good_report_is_complete() {
        val answer = CapabilityProbe { good }.probe()
        assertTrue(answer is Capabilities.Complete, "answer: $answer")
        val complete = answer as Capabilities.Complete
        assertTrue(complete.videoDecoders.any { it.codec == "h264" && it.profile == "Main" && !it.hardware }, "h264 Main listed")
        assertEquals(listOf("aac"), complete.audioDecoders)
    }

    @Test
    fun each_probe_reads_the_platform_afresh() {
        var reads = 0
        val probe = CapabilityProbe {
            reads += 1
            good
        }
        probe.probe()
        probe.probe()
        assertEquals(2, reads)
    }
}
