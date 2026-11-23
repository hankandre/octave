package dev.octave.player.media3

import android.media.MediaCodecInfo.CodecProfileLevel
import android.view.Display.HdrCapabilities
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import dev.octave.player.engine.CapabilityMap
import dev.octave.player.engine.PlatformProfile
import dev.octave.player.engine.PlatformVideoDecoder
import dev.octave.player.seam.Capabilities
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// T8-07 items 1 and 5: how the platform's lists become the report. The hardware flag, the HDR types and the
// passthrough formats are read as item 1 asks, and a read that throws leaves only its own part as "cannot tell".
@OptIn(UnstableApi::class)
class PlatformReportBuilderTest {
    private class FakeLists(
        val video: Map<String, List<ListedDecoder>> = emptyMap(),
        val audio: Set<String> = emptySet(),
        val hdr: List<Int> = emptyList(),
        val passthrough: Set<Int> = emptySet(),
        val throwingVideo: Set<String> = emptySet(),
        val throwingAudio: Set<String> = emptySet(),
        val hdrThrows: Boolean = false,
        val passthroughThrows: Boolean = false,
    ) : PlatformLists {
        override fun videoDecoders(mime: String): List<ListedDecoder> {
            if (mime in throwingVideo) throw IllegalStateException("decoder query failed")
            return video[mime].orEmpty()
        }

        override fun hasAudioDecoder(mime: String): Boolean {
            if (mime in throwingAudio) throw IllegalStateException("decoder query failed")
            return mime in audio
        }

        override fun hdrTypes(): List<Int> {
            if (hdrThrows) throw IllegalStateException("no display mode")
            return hdr
        }

        override fun supportedPassthrough(encodings: List<Int>): List<Int> {
            if (passthroughThrows) throw IllegalStateException("no route")
            return encodings.filter { it in passthrough }
        }
    }

    private fun listed(vararg profiles: Int, hardwareAccelerated: Boolean = true, softwareOnly: Boolean = false) =
        ListedDecoder(hardwareAccelerated, softwareOnly, profiles.toList(), maxWidth = 3840, maxHeight = 2160)

    private val avcHigh = listed(CodecProfileLevel.AVCProfileHigh)
    private val hevcMain = listed(CodecProfileLevel.HEVCProfileMain)

    private val tv = FakeLists(
        video = mapOf("video/avc" to listOf(avcHigh), "video/hevc" to listOf(hevcMain)),
        audio = setOf("audio/mp4a-latm", "audio/ac3"),
        hdr = listOf(HdrCapabilities.HDR_TYPE_HDR10, HdrCapabilities.HDR_TYPE_HLG, HdrCapabilities.HDR_TYPE_HDR10),
        passthrough = setOf(C.ENCODING_AC3, C.ENCODING_E_AC3),
    )

    @Test
    fun hardware_is_hardware_accelerated_and_not_software_only() {
        val lists = FakeLists(
            video = mapOf(
                "video/avc" to listOf(
                    listed(CodecProfileLevel.AVCProfileMain, hardwareAccelerated = true, softwareOnly = false),
                    listed(CodecProfileLevel.AVCProfileMain, hardwareAccelerated = false, softwareOnly = true),
                    listed(CodecProfileLevel.AVCProfileMain, hardwareAccelerated = true, softwareOnly = true),
                    listed(CodecProfileLevel.AVCProfileMain, hardwareAccelerated = false, softwareOnly = false),
                ),
            ),
        )
        assertEquals(listOf(true, false, false, false), PlatformReportBuilder.build(lists).video.map { it.hardware })
    }

    @Test
    fun a_decoder_keeps_its_named_profiles_and_its_size() {
        val report = PlatformReportBuilder.build(tv)
        assertEquals(
            listOf(
                PlatformVideoDecoder("h264", true, listOf(PlatformProfile("High", null)), 3840, 2160),
                PlatformVideoDecoder("hevc", true, listOf(PlatformProfile("Main", null)), 3840, 2160),
            ),
            report.video,
        )
    }

    @Test
    fun hdr_types_and_passthrough_formats_are_named_once_each() {
        val report = PlatformReportBuilder.build(tv)
        assertEquals(listOf("hdr10", "hlg"), report.hdr)
        assertEquals(listOf("ac3", "eac3"), report.passthrough)
        assertEquals(listOf("aac", "ac3") + PlatformNames.SINK_PCM, report.audio)
    }

    @Test
    fun an_hdr_read_that_throws_leaves_the_rest_of_the_report() {
        val report = PlatformReportBuilder.build(FakeLists(tv.video, tv.audio, tv.hdr, tv.passthrough, hdrThrows = true))
        assertEquals(emptyList<String>(), report.hdr)
        assertEquals(listOf("ac3", "eac3"), report.passthrough)
        assertTrue(CapabilityMap.capabilities(report) is Capabilities.Complete)
    }

    @Test
    fun a_passthrough_read_that_throws_leaves_the_rest_of_the_report() {
        val report = PlatformReportBuilder.build(FakeLists(tv.video, tv.audio, tv.hdr, tv.passthrough, passthroughThrows = true))
        assertEquals(emptyList<String>(), report.passthrough)
        assertEquals(listOf("hdr10", "hlg"), report.hdr)
        assertTrue(CapabilityMap.capabilities(report) is Capabilities.Complete)
    }

    @Test
    fun a_codec_whose_decoder_query_throws_is_left_out_alone() {
        val lists = FakeLists(
            video = tv.video + ("video/wvc1" to listOf(listed())),
            audio = tv.audio,
            throwingVideo = setOf("video/wvc1", "video/mpeg2"),
            throwingAudio = setOf("audio/ac3"),
        )
        val report = PlatformReportBuilder.build(lists)
        assertEquals(listOf("h264", "hevc"), report.video.map { it.codec })
        assertEquals(listOf("aac") + PlatformNames.SINK_PCM, report.audio)
        assertTrue(CapabilityMap.capabilities(report) is Capabilities.Complete)
    }

    @Test
    fun every_video_query_throwing_leaves_no_decoder_and_is_cannot_tell() {
        val lists = FakeLists(video = tv.video, throwingVideo = PlatformNames.VIDEO_CODECS.mapNotNull { PlatformNames.videoMime(it) }.toSet())
        assertEquals(Capabilities.Failed, CapabilityMap.capabilities(PlatformReportBuilder.build(lists)))
    }

    @Test
    fun a_decoder_whose_profiles_all_lack_a_name_is_left_out_where_media3_reads_the_profile() {
        val lists = FakeLists(video = mapOf("video/avc" to listOf(listed(CodecProfileLevel.AVCProfileHigh422)), "video/hevc" to listOf(hevcMain)))
        assertEquals(listOf("hevc"), PlatformReportBuilder.build(lists).video.map { it.codec })
    }

    @Test
    fun an_mpeg2_or_mpeg4_decoder_whose_profiles_all_lack_a_name_keeps_a_profile_less_entry() {
        val lists = FakeLists(
            video = mapOf(
                "video/mpeg2" to listOf(listed(CodecProfileLevel.MPEG2Profile422)),
                "video/mp4v-es" to listOf(listed(CodecProfileLevel.MPEG4ProfileSimpleScalable)),
            ),
        )
        val report = PlatformReportBuilder.build(lists)
        assertEquals(listOf("mpeg2video", "mpeg4"), report.video.map { it.codec })
        assertEquals(listOf(emptyList<PlatformProfile>(), emptyList()), report.video.map { it.profiles })
        val answer = CapabilityMap.capabilities(report) as Capabilities.Complete
        assertEquals(listOf(null, null), answer.videoDecoders.map { it.profile })
    }
}
