package dev.octave.artwork.load

// A decoded image and the bytes it holds in memory. `image` is opaque here: a Bitmap on Android.
class Decoded(val image: Any, val byteCount: Int) {
    override fun toString(): String = "Decoded($byteCount bytes)"
}

// Decodes an answer's bytes at a drawn width, or answers null for a body it cannot or will not decode.
interface ArtworkDecoder {
    fun decode(bytes: ByteArray, width: Int): Decoded?
}
