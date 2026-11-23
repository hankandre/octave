package dev.octave.player.engine

import dev.octave.player.seam.Capabilities
import dev.octave.player.seam.PlayerEventMaps
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

// T8-07 spec check issue 1 (docs/specs/T8-07.md, "Building the answer" step 4): a decoder that reports no profile
// level is listed only where Media3 1.11.1 would play any profile on it. Media3 reads the source's profile for h264,
// hevc, av1 and vp9 and refuses a decoder that reports none, so such a decoder gets no entry; it reads no profile for
// mpeg2video and mpeg4, so such a decoder gets one entry with no profile, as VP8 and VC-1 always do.
class CapabilityMapEmptyProfilesTest {
    private fun answer(vararg decoders: PlatformVideoDecoder): Capabilities =
        CapabilityMap.capabilities(PlatformReport(video = decoders.toList(), audio = listOf("aac"), hdr = emptyList(), passthrough = emptyList()))

    private fun silent(codec: String) = PlatformVideoDecoder(codec = codec, hardware = true, profiles = emptyList(), maxWidth = 1920, maxHeight = 1080)

    private val main = PlatformVideoDecoder(codec = "h264", hardware = false, profiles = listOf(PlatformProfile(name = "Main", bitDepth = null)), maxWidth = null, maxHeight = null)

    @Test
    fun a_silent_decoder_of_a_codec_media3_checks_by_profile_gets_no_entry() {
        for (codec in listOf("h264", "hevc", "av1", "vp9")) {
            assertEquals(Capabilities.Failed, answer(silent(codec)), codec)
            val listed = PlayerEventMaps.toMap(answer(silent(codec), main))["videoDecoders"] as List<*>
            assertEquals(setOf("Main", "Constrained Baseline"), listed.map { (it as Map<*, *>)["profile"] }.toSet(), codec)
            assertEquals(2, listed.size, codec)
        }
    }

    @Test
    fun a_silent_decoder_of_a_codec_media3_does_not_check_by_profile_gets_one_entry_with_no_profile() {
        for (codec in listOf("mpeg2video", "mpeg4", "vp8", "vc1")) {
            val listed = PlayerEventMaps.toMap(answer(silent(codec)))["videoDecoders"] as List<*>
            assertEquals(listOf(mapOf("codec" to codec, "hardware" to true, "maxWidth" to 1920, "maxHeight" to 1080)), listed, codec)
        }
    }
}
