package dev.octave.artwork

import android.graphics.Bitmap
import dev.octave.artwork.load.BlurHash
import dev.octave.artwork.load.Decoded

// Turns a BlurHash into the 32x32 ARGB_8888 preview bitmap (T3-39). The only Android code on the preview path; the
// decoder is plain Kotlin. A refused hash and any Throwable are null.
internal object BitmapPreviews {
    fun decode(hash: String): Decoded? = try {
        BlurHash.decode(hash)?.let { pixels ->
            val bitmap = Bitmap.createBitmap(pixels, BlurHash.SIZE, BlurHash.SIZE, Bitmap.Config.ARGB_8888)
            Decoded(bitmap, bitmap.allocationByteCount)
        }
    } catch (_: Throwable) {
        null
    }
}
