package dev.octave.player.media3

import android.content.Context
import android.hardware.display.DisplayManager
import android.os.Build
import android.view.Display
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioCapabilities
import androidx.media3.exoplayer.mediacodec.MediaCodecUtil
import dev.octave.player.engine.PlatformReport

// The Android half of the capability probe (T8-07 item 1): reads this device's decoders through Media3's list, so the
// report holds what this engine will try (Media3 skips decoders it knows are broken; D1), the default display's HDR
// types and Media3's passthrough answer. PlatformReportBuilder assembles the report and makes a read that throws
// "cannot tell" for that part alone. Null when there is no context. It logs nothing.
@OptIn(UnstableApi::class)
object DevicePlatformReader {
    private const val MODE_HDR_SDK = 34

    fun read(context: Context?): PlatformReport? {
        if (context == null) return null
        return PlatformReportBuilder.build(AndroidLists(context))
    }

    private class AndroidLists(private val context: Context) : PlatformLists {
        override fun videoDecoders(mime: String): List<ListedDecoder> = decoders(mime).map { info ->
            val sizes = info.capabilities?.videoCapabilities
            ListedDecoder(
                hardwareAccelerated = info.hardwareAccelerated,
                softwareOnly = info.softwareOnly,
                profileConstants = info.profileLevels.map { it.profile },
                maxWidth = sizes?.supportedWidths?.upper,
                maxHeight = sizes?.supportedHeights?.upper,
            )
        }

        override fun hasAudioDecoder(mime: String): Boolean = decoders(mime).isNotEmpty()

        override fun hdrTypes(): List<Int> {
            val display = context.getSystemService(DisplayManager::class.java)?.getDisplay(Display.DEFAULT_DISPLAY) ?: return emptyList()
            val types: IntArray = if (Build.VERSION.SDK_INT >= MODE_HDR_SDK) display.mode.supportedHdrTypes else legacyHdrTypes(display)
            return types.toList()
        }

        // Media3 1.11.1's current overload (AudioCapabilities.java lines 145-151; the three-argument one is deprecated
        // at line 127): the default attributes, the default route, no spatializer masks.
        override fun supportedPassthrough(encodings: List<Int>): List<Int> {
            val capabilities = AudioCapabilities.getCapabilities(context, AudioAttributes.DEFAULT, null, emptyList())
            return encodings.filter { capabilities.supportsEncoding(it) }
        }

        private fun decoders(mime: String) = MediaCodecUtil.getDecoderInfos(mime, /* secure= */ false, /* tunneling= */ false)

        // Display.getHdrCapabilities, deprecated from API 34 in favour of Display.Mode.getSupportedHdrTypes.
        @Suppress("DEPRECATION")
        private fun legacyHdrTypes(display: Display): IntArray = display.hdrCapabilities?.supportedHdrTypes ?: IntArray(0)
    }
}
