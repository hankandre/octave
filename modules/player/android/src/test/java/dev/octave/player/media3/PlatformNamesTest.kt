package dev.octave.player.media3

import android.media.MediaCodecInfo.CodecProfileLevel
import android.view.Display.HdrCapabilities
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

// T8-07 item 1 (docs/specs/T8-07.md, "Reading the platform", "Profile names"; Test plan 4): PlatformNames holds the
// tables from platform constants to the port's names, read by DevicePlatformReader:
// - videoMime(codec) and audioMime(codec): the MIME type Media3's MediaCodecUtil.getDecoderInfos is asked for;
// - profile(codec, constant): the PlatformProfile (Jellyfin's MediaStream.Profile spelling, and the bit depth for AV1
//   and VP9) of a MediaCodecInfo.CodecProfileLevel constant, or null when the constant is not mapped;
// - hdrType(constant): the port's HDR type of a Display.HdrCapabilities constant, or null;
// - passthroughFormat(encoding): the port's passthrough format of a Media3 C.ENCODING_* constant, or null.
// The constants are compile-time constants of the Android and Media3 classes, inlined by the compiler.
@OptIn(UnstableApi::class)
class PlatformNamesTest {
    private fun assertProfile(codec: String, constant: Int, name: String, bitDepth: Int? = null, checkDepth: Boolean = false) {
        val profile = PlatformNames.profile(codec, constant)
        assertNotNull(profile, "$codec $constant maps to $name")
        assertEquals(name, profile!!.name, "$codec $constant")
        if (checkDepth) assertEquals(bitDepth, profile.bitDepth, "$codec $constant bit depth")
    }

    @Test
    fun video_mime_types() {
        val expected = mapOf(
            "h264" to "video/avc",
            "hevc" to "video/hevc",
            "av1" to "video/av01",
            "vp9" to "video/x-vnd.on2.vp9",
            "vp8" to "video/x-vnd.on2.vp8",
            "mpeg2video" to "video/mpeg2",
            "mpeg4" to "video/mp4v-es",
            "vc1" to "video/wvc1",
        )
        for ((codec, mime) in expected) assertEquals(mime, PlatformNames.videoMime(codec), codec)
        assertNull(PlatformNames.videoMime("msmpeg4v3"))
    }

    @Test
    fun audio_mime_types() {
        val expected = mapOf(
            "aac" to "audio/mp4a-latm",
            "mp3" to "audio/mpeg",
            "ac3" to "audio/ac3",
            "eac3" to "audio/eac3",
            "truehd" to "audio/true-hd",
            "dts" to "audio/vnd.dts",
            "flac" to "audio/flac",
            "alac" to "audio/alac",
            "opus" to "audio/opus",
            "vorbis" to "audio/vorbis",
        )
        for ((codec, mime) in expected) assertEquals(mime, PlatformNames.audioMime(codec), codec)
        assertNull(PlatformNames.audioMime("wmav2"))
    }

    @Test
    fun h264_profiles() {
        assertProfile("h264", CodecProfileLevel.AVCProfileConstrainedBaseline, "Constrained Baseline")
        assertProfile("h264", CodecProfileLevel.AVCProfileBaseline, "Baseline")
        assertProfile("h264", CodecProfileLevel.AVCProfileMain, "Main")
        assertProfile("h264", CodecProfileLevel.AVCProfileExtended, "Extended")
        assertProfile("h264", CodecProfileLevel.AVCProfileHigh, "High")
        assertProfile("h264", CodecProfileLevel.AVCProfileHigh10, "High 10")
        assertNull(PlatformNames.profile("h264", CodecProfileLevel.AVCProfileConstrainedHigh), "ConstrainedHigh")
        assertNull(PlatformNames.profile("h264", CodecProfileLevel.AVCProfileHigh422), "High422")
        assertNull(PlatformNames.profile("h264", CodecProfileLevel.AVCProfileHigh444), "High444")
    }

    @Test
    fun hevc_profiles() {
        assertProfile("hevc", CodecProfileLevel.HEVCProfileMain, "Main")
        assertProfile("hevc", CodecProfileLevel.HEVCProfileMain10, "Main 10")
        assertProfile("hevc", CodecProfileLevel.HEVCProfileMain10HDR10, "Main 10")
        assertProfile("hevc", CodecProfileLevel.HEVCProfileMain10HDR10Plus, "Main 10")
        assertProfile("hevc", CodecProfileLevel.HEVCProfileMainStill, "Main Still Picture")
    }

    @Test
    fun av1_profiles_carry_their_bit_depth() {
        assertProfile("av1", CodecProfileLevel.AV1ProfileMain8, "Main", 8, checkDepth = true)
        assertProfile("av1", CodecProfileLevel.AV1ProfileMain10, "Main", 10, checkDepth = true)
        assertProfile("av1", CodecProfileLevel.AV1ProfileMain10HDR10, "Main", 10, checkDepth = true)
        assertProfile("av1", CodecProfileLevel.AV1ProfileMain10HDR10Plus, "Main", 10, checkDepth = true)
    }

    @Test
    fun vp9_profiles() {
        assertProfile("vp9", CodecProfileLevel.VP9Profile0, "Profile 0")
        assertProfile("vp9", CodecProfileLevel.VP9Profile1, "Profile 1")
        for (constant in listOf(CodecProfileLevel.VP9Profile2, CodecProfileLevel.VP9Profile2HDR, CodecProfileLevel.VP9Profile2HDR10Plus)) {
            assertProfile("vp9", constant, "Profile 2", 10, checkDepth = true)
        }
        for (constant in listOf(CodecProfileLevel.VP9Profile3, CodecProfileLevel.VP9Profile3HDR, CodecProfileLevel.VP9Profile3HDR10Plus)) {
            assertProfile("vp9", constant, "Profile 3", 10, checkDepth = true)
        }
    }

    @Test
    fun mpeg2_profiles() {
        assertProfile("mpeg2video", CodecProfileLevel.MPEG2ProfileSimple, "Simple")
        assertProfile("mpeg2video", CodecProfileLevel.MPEG2ProfileMain, "Main")
        assertProfile("mpeg2video", CodecProfileLevel.MPEG2ProfileHigh, "High")
        assertProfile("mpeg2video", CodecProfileLevel.MPEG2ProfileSNR, "SNR Scalable")
        assertProfile("mpeg2video", CodecProfileLevel.MPEG2ProfileSpatial, "Spatially Scalable")
        assertNull(PlatformNames.profile("mpeg2video", CodecProfileLevel.MPEG2Profile422), "MPEG-2 4:2:2")
    }

    @Test
    fun mpeg4_profiles() {
        assertProfile("mpeg4", CodecProfileLevel.MPEG4ProfileSimple, "Simple Profile")
        assertProfile("mpeg4", CodecProfileLevel.MPEG4ProfileAdvancedSimple, "Advanced Simple Profile")
        assertProfile("mpeg4", CodecProfileLevel.MPEG4ProfileMain, "Main Profile")
        assertProfile("mpeg4", CodecProfileLevel.MPEG4ProfileCore, "Core Profile")
    }

    @Test
    fun profiles_of_one_codec_are_not_read_under_another() {
        // AVCProfileHigh (8) and VP9Profile3 (8) share a value; the codec decides.
        assertEquals("High", PlatformNames.profile("h264", CodecProfileLevel.AVCProfileHigh)?.name)
        assertEquals("Profile 3", PlatformNames.profile("vp9", CodecProfileLevel.VP9Profile3)?.name)
        assertNull(PlatformNames.profile("msmpeg4v3", CodecProfileLevel.AVCProfileHigh))
    }

    @Test
    fun hdr_types() {
        assertEquals("hdr10", PlatformNames.hdrType(HdrCapabilities.HDR_TYPE_HDR10))
        assertEquals("hdr10-plus", PlatformNames.hdrType(HdrCapabilities.HDR_TYPE_HDR10_PLUS))
        assertEquals("hlg", PlatformNames.hdrType(HdrCapabilities.HDR_TYPE_HLG))
        assertEquals("dolby-vision", PlatformNames.hdrType(HdrCapabilities.HDR_TYPE_DOLBY_VISION))
        assertNull(PlatformNames.hdrType(-1))
        assertNull(PlatformNames.hdrType(999))
    }

    @Test
    fun passthrough_encodings() {
        assertEquals("ac3", PlatformNames.passthroughFormat(C.ENCODING_AC3))
        assertEquals("eac3", PlatformNames.passthroughFormat(C.ENCODING_E_AC3))
        assertEquals("eac3-joc", PlatformNames.passthroughFormat(C.ENCODING_E_AC3_JOC))
        assertEquals("dts", PlatformNames.passthroughFormat(C.ENCODING_DTS))
        assertEquals("dts-hd", PlatformNames.passthroughFormat(C.ENCODING_DTS_HD))
        assertEquals("truehd", PlatformNames.passthroughFormat(C.ENCODING_DOLBY_TRUEHD))
        assertNull(PlatformNames.passthroughFormat(C.ENCODING_PCM_16BIT))
    }
}
