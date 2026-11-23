package dev.octave.player.media3

import dev.octave.player.engine.CapabilityMap
import dev.octave.player.engine.PlatformReport
import dev.octave.player.engine.PlatformVideoDecoder

// One decoder as the platform lists it, before PlatformNames names it: Media3's MediaCodecInfo flags, the raw
// CodecProfileLevel profile constants and the largest size it reports.
data class ListedDecoder(
    val hardwareAccelerated: Boolean,
    val softwareOnly: Boolean,
    val profileConstants: List<Int>,
    val maxWidth: Int?,
    val maxHeight: Int?,
)

// The platform reads DevicePlatformReader makes, behind an interface so the report's assembly runs on the JVM.
interface PlatformLists {
    fun videoDecoders(mime: String): List<ListedDecoder>

    fun hasAudioDecoder(mime: String): Boolean

    fun hdrTypes(): List<Int>

    fun supportedPassthrough(encodings: List<Int>): List<Int>
}

// Builds the PlatformReport from the platform's lists (T8-07 item 1). Each read stands alone (item 5): a codec whose
// decoder query throws is left out, and an HDR or passthrough read that throws gives an empty list, so the part that
// failed is "cannot tell" and the rest of the report stands. No video decoder left is "cannot tell" in CapabilityMap.
object PlatformReportBuilder {
    fun build(lists: PlatformLists): PlatformReport = PlatformReport(
        video = PlatformNames.VIDEO_CODECS.flatMap { codec ->
            val mime = PlatformNames.videoMime(codec) ?: return@flatMap emptyList()
            orNone { lists.videoDecoders(mime) }.mapNotNull { decoder(codec, it) }
        },
        audio = PlatformNames.AUDIO_CODECS.filter { codec ->
            val mime = PlatformNames.audioMime(codec) ?: return@filter false
            try {
                lists.hasAudioDecoder(mime)
            } catch (_: Exception) {
                false
            }
        } + PlatformNames.SINK_PCM,
        hdr = orNone { lists.hdrTypes() }.mapNotNull { PlatformNames.hdrType(it) }.distinct(),
        passthrough = orNone { lists.supportedPassthrough(PlatformNames.PASSTHROUGH_ENCODINGS) }
            .mapNotNull { PlatformNames.passthroughFormat(it) }.distinct(),
    )

    // A decoder of a codec Media3 reads the profile of, which reports profile levels none of which has a name (only
    // High 4:2:2, say), is left out, so that for those codecs an empty profile list means the platform reported none.
    // mpeg2video and mpeg4 decoders keep an entry with no named profile: Media3 reads no profile for them and plays
    // any (CapabilityMap.UNREAD_PROFILE).
    private fun decoder(codec: String, listed: ListedDecoder): PlatformVideoDecoder? {
        val profiles = listed.profileConstants.mapNotNull { PlatformNames.profile(codec, it) }.distinct()
        val unnamed = listed.profileConstants.isNotEmpty() && profiles.isEmpty()
        if (unnamed && PlatformNames.readsProfiles(codec) && codec !in CapabilityMap.UNREAD_PROFILE) return null
        return PlatformVideoDecoder(
            codec = codec,
            hardware = listed.hardwareAccelerated && !listed.softwareOnly,
            profiles = profiles,
            maxWidth = listed.maxWidth,
            maxHeight = listed.maxHeight,
        )
    }

    private inline fun <T> orNone(read: () -> List<T>): List<T> = try {
        read()
    } catch (_: Exception) {
        emptyList()
    }
}
