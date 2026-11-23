package dev.octave.player.media3

import android.content.Context
import android.hardware.display.DisplayManager
import android.os.Build
import android.view.Display
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioCapabilities
import androidx.media3.exoplayer.mediacodec.MediaCodecInfo
import androidx.media3.exoplayer.mediacodec.MediaCodecUtil
import dev.octave.player.engine.PlatformReport
import dev.octave.player.engine.PlatformVideoDecoder

// The Android half of the capability probe (T8-07 item 1): reads this device's decoders through Media3's list, so the
// report holds what this engine will try (Media3 skips decoders it knows are broken; D1), the default display's HDR
// types and Media3's passthrough answer. It throws whatever the platform throws; CapabilityProbe makes that "cannot
// tell". Null when there is no context. It logs nothing.
@OptIn(UnstableApi::class)
object DevicePlatformReader {
    private const val MODE_HDR_SDK = 34

    fun read(context: Context?): PlatformReport? {
        if (context == null) return null
        return PlatformReport(
            video = video(),
            audio = audio(),
            hdr = hdr(context),
            passthrough = passthrough(context),
        )
    }

    private fun decoders(mime: String): List<MediaCodecInfo> =
        MediaCodecUtil.getDecoderInfos(mime, /* secure= */ false, /* tunneling= */ false)

    private fun video(): List<PlatformVideoDecoder> = PlatformNames.VIDEO_CODECS.flatMap { codec ->
        val mime = PlatformNames.videoMime(codec) ?: return@flatMap emptyList()
        decoders(mime).mapNotNull { info -> decoder(codec, info) }
    }

    // A decoder that reports profile levels none of which has a name (only High 4:2:2, say) is left out, so that an
    // empty profile list always means the platform reported none.
    private fun decoder(codec: String, info: MediaCodecInfo): PlatformVideoDecoder? {
        val levels = info.profileLevels
        val profiles = levels.mapNotNull { PlatformNames.profile(codec, it.profile) }.distinct()
        if (PlatformNames.readsProfiles(codec) && levels.isNotEmpty() && profiles.isEmpty()) return null
        val sizes = info.capabilities?.videoCapabilities
        return PlatformVideoDecoder(
            codec = codec,
            hardware = info.hardwareAccelerated && !info.softwareOnly,
            profiles = profiles,
            maxWidth = sizes?.supportedWidths?.upper,
            maxHeight = sizes?.supportedHeights?.upper,
        )
    }

    private fun audio(): List<String> =
        PlatformNames.AUDIO_CODECS.filter { codec -> PlatformNames.audioMime(codec)?.let { decoders(it).isNotEmpty() } == true } +
            PlatformNames.SINK_PCM

    private fun hdr(context: Context): List<String> {
        val display = context.getSystemService(DisplayManager::class.java)?.getDisplay(Display.DEFAULT_DISPLAY) ?: return emptyList()
        val types: IntArray = if (Build.VERSION.SDK_INT >= MODE_HDR_SDK) display.mode.supportedHdrTypes else legacyHdrTypes(display)
        return types.toList().mapNotNull { PlatformNames.hdrType(it) }.distinct()
    }

    // Display.getHdrCapabilities, deprecated from API 34 in favour of Display.Mode.getSupportedHdrTypes.
    @Suppress("DEPRECATION")
    private fun legacyHdrTypes(display: Display): IntArray = display.hdrCapabilities?.supportedHdrTypes ?: IntArray(0)

    // Media3 1.11.1's current overload (AudioCapabilities.java lines 145-151; the three-argument one is deprecated at
    // line 127): the default attributes, the default route, no spatializer masks.
    private fun passthrough(context: Context): List<String> {
        val capabilities = AudioCapabilities.getCapabilities(context, AudioAttributes.DEFAULT, null, emptyList())
        return PlatformNames.PASSTHROUGH_ENCODINGS.filter { capabilities.supportsEncoding(it) }.mapNotNull { PlatformNames.passthroughFormat(it) }
    }
}
