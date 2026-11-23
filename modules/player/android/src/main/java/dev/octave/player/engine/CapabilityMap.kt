package dev.octave.player.engine

import dev.octave.player.seam.Capabilities
import dev.octave.player.seam.VideoDecoder

// What the platform reports about this device (T8-07), already named by media3/PlatformNames: plain Kotlin, so a
// Swift engine can fill the same shape. A profile's bitDepth is set only for AV1 and VP9, whose profile names do not
// fix the depth.
data class PlatformProfile(val name: String, val bitDepth: Int?)

data class PlatformVideoDecoder(
    val codec: String,
    val hardware: Boolean,
    val profiles: List<PlatformProfile>,
    val maxWidth: Int?,
    val maxHeight: Int?,
)

data class PlatformReport(
    val video: List<PlatformVideoDecoder>,
    val audio: List<String>,
    val hdr: List<String>,
    val passthrough: List<String>,
)

// Turns the platform's report into the port's PlayerCapabilities (docs/specs/T8-07.md, "Building the answer").
// The core matches a profile exactly, so each decoder lists every profile it plays as its own entry: a reported
// profile and the profiles it implies by the codec standards (D4). A profile name the app's reader would widen to
// "any profile" is never emitted (D5). No video decoder left is "cannot tell" (D7).
object CapabilityMap {
    // The port's vocabularies (packages/core/src/domain/player-engine.ts).
    val VIDEO_CODECS = listOf("h264", "hevc", "av1", "vp9", "vp8", "mpeg2video", "mpeg4", "vc1")
    val AUDIO_CODECS = listOf("aac", "mp3", "ac3", "eac3", "truehd", "dts", "flac", "alac", "opus", "vorbis", "pcm_s16le", "pcm_s24le")
    val HDR_TYPES = listOf("hdr10", "hdr10-plus", "hlg", "dolby-vision")
    val PASSTHROUGH_FORMATS = listOf("ac3", "eac3", "eac3-joc", "dts", "dts-hd", "truehd")

    // The reader's profile pattern (packages/core/src/domain/player-capabilities.ts).
    private val PROFILE = Regex("^[A-Za-z0-9 .+-]{1,32}$")

    // Codecs whose decoders are listed with no profile, whatever they report.
    private val ANY_PROFILE = setOf("vp8", "vc1")

    // Codecs whose profile Media3 1.11.1 never reads from a source, so it plays any profile on a decoder that reports
    // none: CodecSpecificDataUtil.getMediaCodecProfileAndLevel parses only avc1/avc2, vp09, hev1/hvc1, av01 (and
    // non-video ids) and answers null for the rest (lines 876-910), and MediaCodecInfo.isCodecProfileAndLevelSupported
    // answers true for a null (line 346). For h264, hevc, av1 and vp9 a decoder reporting no profile level is refused
    // by that check (the loop at line 399 finds nothing), so it gets no entry.
    private val UNREAD_PROFILE = setOf("mpeg2video", "mpeg4")

    // Supersets that hold by the codec standards (D4); av1 and vp9 imply nothing, their bit depth carries it.
    private val IMPLIES: Map<String, Map<String, List<String>>> = mapOf(
        "h264" to mapOf(
            "High 10" to listOf("High", "Main", "Constrained Baseline"),
            "High" to listOf("Main", "Constrained Baseline"),
            "Main" to listOf("Constrained Baseline"),
            "Baseline" to listOf("Constrained Baseline"),
        ),
        "hevc" to mapOf("Main 10" to listOf("Main")),
        "mpeg2video" to mapOf("High" to listOf("Main", "Simple"), "Main" to listOf("Simple")),
        "mpeg4" to mapOf("Advanced Simple Profile" to listOf("Simple Profile")),
    )

    // Codecs whose entries state the bit depth their profile allows.
    private val STATES_DEPTH = setOf("av1", "vp9")

    fun capabilities(report: PlatformReport): Capabilities {
        val decoders = LinkedHashSet<Entry>()
        for (decoder in report.video) {
            if (decoder.codec !in VIDEO_CODECS) continue
            entries(decoder).forEach { decoders.add(it) }
        }
        if (decoders.isEmpty()) return Capabilities.Failed
        return Capabilities.Complete(
            videoDecoders = decoders.map { it.toDecoder() },
            audioDecoders = known(report.audio, AUDIO_CODECS),
            hdr = known(report.hdr, HDR_TYPES),
            passthrough = known(report.passthrough, PASSTHROUGH_FORMATS),
        )
    }

    private fun entries(decoder: PlatformVideoDecoder): List<Entry> {
        fun entry(profile: String?, bitDepth: Int?) = Entry(
            codec = decoder.codec,
            hardware = decoder.hardware,
            profile = profile,
            maxBitDepth = if (decoder.codec in STATES_DEPTH) bitDepth else null,
            maxWidth = decoder.maxWidth,
            maxHeight = decoder.maxHeight,
        )
        if (decoder.codec in ANY_PROFILE) return listOf(entry(null, null))
        if (decoder.profiles.isEmpty()) return if (decoder.codec in UNREAD_PROFILE) listOf(entry(null, null)) else emptyList()
        val implied = IMPLIES[decoder.codec].orEmpty()
        return decoder.profiles.flatMap { profile ->
            listOf(entry(profile.name, profile.bitDepth)) + implied[profile.name].orEmpty().map { entry(it, null) }
        }.filter { it.profile != null && PROFILE.matches(it.profile) }
    }

    private fun known(values: List<String>, allowed: List<String>): List<String> = values.filter { it in allowed }.distinct()

    private data class Entry(
        val codec: String,
        val hardware: Boolean,
        val profile: String?,
        val maxBitDepth: Int?,
        val maxWidth: Int?,
        val maxHeight: Int?,
    ) {
        fun toDecoder() = VideoDecoder(codec, hardware, profile, maxBitDepth, maxWidth, maxHeight)
    }
}
