package dev.octave.artwork

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import dev.octave.artwork.load.ArtworkDecoder
import dev.octave.artwork.load.DecodeSize
import dev.octave.artwork.load.Decoded

// Decodes an answer with the platform's BitmapFactory (T3-11): the bounds first, then ARGB_8888 sampled down to the
// drawn width (DecodeSize). It reads the JPEG Jellyscale sends and the WebP Jellyfin sends. A body it cannot read, a
// side of 0 or over 8192 px, and any Throwable are null.
object BitmapArtworkDecoder : ArtworkDecoder {
    override fun decode(bytes: ByteArray, width: Int): Decoded? = try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val sample = DecodeSize.sampleFor(bounds.outWidth, bounds.outHeight, width)
        if (sample == null) {
            null
        } else {
            val options = BitmapFactory.Options().apply {
                inSampleSize = sample
                inPreferredConfig = Bitmap.Config.ARGB_8888
            }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)?.let { Decoded(it, it.allocationByteCount) }
        }
    } catch (_: Throwable) {
        null
    }
}
