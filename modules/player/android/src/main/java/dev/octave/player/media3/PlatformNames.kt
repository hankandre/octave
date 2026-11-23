package dev.octave.player.media3

import android.media.MediaCodecInfo.CodecProfileLevel
import android.view.Display.HdrCapabilities
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import dev.octave.player.engine.PlatformProfile

// The tables from platform constants to the port's names (T8-07, docs/specs/T8-07.md, "Profile names"), read by
// DevicePlatformReader. A constant not listed maps to nothing.
//
// Profile spellings are Jellyfin's MediaStream.Profile, which is ffprobe's profile name: libavcodec/profiles.c at
// FFmpeg n7.1.3 and n8.1.3 (the bases of jellyfin-ffmpeg 7.1.3-Jellyfin in jellyfin/jellyfin:10.11.7 and
// 8.1.3-Jellyfin in jellyfin/jellyfin:12.4.20261026-211555, read with `ffmpeg -version` in each image): ff_h264_profiles
// lines 72-87, ff_hevc_profiles 97-103, ff_mpeg2_video_profiles 116-122, ff_mpeg4_video_profiles 127-143,
// ff_vp9_profiles 155-159, ff_av1_profiles 163-166 (same lines in both tags). The recorded fixture answers hold High,
// Main, Main 10 and LC. Names holding ':' (High 4:2:2, High 4:4:4, MPEG-2 4:2:2) are left out: the app's reader would
// widen them to "any profile" (D5). ConstrainedHigh has no libavcodec name. The constants are the compile-time
// constants of android.media.MediaCodecInfo.CodecProfileLevel and android.view.Display.HdrCapabilities, and Media3's
// C.ENCODING_*, named here rather than written as numbers.
@OptIn(UnstableApi::class)
object PlatformNames {
    private val VIDEO_MIMES = mapOf(
        "h264" to "video/avc",
        "hevc" to "video/hevc",
        "av1" to "video/av01",
        "vp9" to "video/x-vnd.on2.vp9",
        "vp8" to "video/x-vnd.on2.vp8",
        "mpeg2video" to "video/mpeg2",
        "mpeg4" to "video/mp4v-es",
        "vc1" to "video/wvc1",
    )

    private val AUDIO_MIMES = mapOf(
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

    // Linear PCM needs no codec: Media3's DefaultAudioSink.getFormatSupport (1.11.1, lines 687-705) turns any linear
    // PCM encoding, 24-bit included, into 16-bit or float through its audio processors before the output.
    val SINK_PCM = listOf("pcm_s16le", "pcm_s24le")

    private fun named(name: String) = PlatformProfile(name = name, bitDepth = null)

    private fun deep(name: String, bitDepth: Int) = PlatformProfile(name = name, bitDepth = bitDepth)

    private val PROFILES: Map<String, Map<Int, PlatformProfile>> = mapOf(
        "h264" to mapOf(
            CodecProfileLevel.AVCProfileConstrainedBaseline to named("Constrained Baseline"),
            CodecProfileLevel.AVCProfileBaseline to named("Baseline"),
            CodecProfileLevel.AVCProfileMain to named("Main"),
            CodecProfileLevel.AVCProfileExtended to named("Extended"),
            CodecProfileLevel.AVCProfileHigh to named("High"),
            CodecProfileLevel.AVCProfileHigh10 to named("High 10"),
        ),
        "hevc" to mapOf(
            CodecProfileLevel.HEVCProfileMain to named("Main"),
            CodecProfileLevel.HEVCProfileMain10 to named("Main 10"),
            CodecProfileLevel.HEVCProfileMain10HDR10 to named("Main 10"),
            CodecProfileLevel.HEVCProfileMain10HDR10Plus to named("Main 10"),
            CodecProfileLevel.HEVCProfileMainStill to named("Main Still Picture"),
        ),
        "av1" to mapOf(
            CodecProfileLevel.AV1ProfileMain8 to deep("Main", 8),
            CodecProfileLevel.AV1ProfileMain10 to deep("Main", 10),
            CodecProfileLevel.AV1ProfileMain10HDR10 to deep("Main", 10),
            CodecProfileLevel.AV1ProfileMain10HDR10Plus to deep("Main", 10),
        ),
        "vp9" to mapOf(
            CodecProfileLevel.VP9Profile0 to deep("Profile 0", 8),
            CodecProfileLevel.VP9Profile1 to deep("Profile 1", 8),
            CodecProfileLevel.VP9Profile2 to deep("Profile 2", 10),
            CodecProfileLevel.VP9Profile2HDR to deep("Profile 2", 10),
            CodecProfileLevel.VP9Profile2HDR10Plus to deep("Profile 2", 10),
            CodecProfileLevel.VP9Profile3 to deep("Profile 3", 10),
            CodecProfileLevel.VP9Profile3HDR to deep("Profile 3", 10),
            CodecProfileLevel.VP9Profile3HDR10Plus to deep("Profile 3", 10),
        ),
        "mpeg2video" to mapOf(
            CodecProfileLevel.MPEG2ProfileSimple to named("Simple"),
            CodecProfileLevel.MPEG2ProfileMain to named("Main"),
            CodecProfileLevel.MPEG2ProfileHigh to named("High"),
            CodecProfileLevel.MPEG2ProfileSNR to named("SNR Scalable"),
            CodecProfileLevel.MPEG2ProfileSpatial to named("Spatially Scalable"),
        ),
        "mpeg4" to mapOf(
            CodecProfileLevel.MPEG4ProfileSimple to named("Simple Profile"),
            CodecProfileLevel.MPEG4ProfileAdvancedSimple to named("Advanced Simple Profile"),
            CodecProfileLevel.MPEG4ProfileMain to named("Main Profile"),
            CodecProfileLevel.MPEG4ProfileCore to named("Core Profile"),
        ),
    )

    private val HDR = mapOf(
        HdrCapabilities.HDR_TYPE_HDR10 to "hdr10",
        HdrCapabilities.HDR_TYPE_HDR10_PLUS to "hdr10-plus",
        HdrCapabilities.HDR_TYPE_HLG to "hlg",
        HdrCapabilities.HDR_TYPE_DOLBY_VISION to "dolby-vision",
    )

    private val PASSTHROUGH = mapOf(
        C.ENCODING_AC3 to "ac3",
        C.ENCODING_E_AC3 to "eac3",
        C.ENCODING_E_AC3_JOC to "eac3-joc",
        C.ENCODING_DTS to "dts",
        C.ENCODING_DTS_HD to "dts-hd",
        C.ENCODING_DOLBY_TRUEHD to "truehd",
    )

    val VIDEO_CODECS: List<String> = VIDEO_MIMES.keys.toList()

    val AUDIO_CODECS: List<String> = AUDIO_MIMES.keys.toList()

    val PASSTHROUGH_ENCODINGS: List<Int> = PASSTHROUGH.keys.toList()

    fun videoMime(codec: String): String? = VIDEO_MIMES[codec]

    fun audioMime(codec: String): String? = AUDIO_MIMES[codec]

    // Whether the codec's decoders are read per profile; VP8 and VC-1 are listed with no profile (D6).
    fun readsProfiles(codec: String): Boolean = codec in PROFILES

    fun profile(codec: String, constant: Int): PlatformProfile? = PROFILES[codec]?.get(constant)

    fun hdrType(constant: Int): String? = HDR[constant]

    fun passthroughFormat(encoding: Int): String? = PASSTHROUGH[encoding]
}
