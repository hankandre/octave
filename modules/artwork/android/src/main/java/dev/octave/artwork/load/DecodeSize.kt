package dev.octave.artwork.load

// The decode's sample size (T3-11): Jellyscale ignores maxWidth and sends the stored picture, so the decoder samples a
// large answer down to the drawn width.
object DecodeSize {
    const val MAX_SIDE = 8192

    // The largest power of two that keeps sourceWidth / sample at or above `width`; 1 when the source is no wider (no
    // upscale). Null for a source the decoder refuses: a side of 0 or less, or over MAX_SIDE.
    fun sampleFor(sourceWidth: Int, sourceHeight: Int, width: Int): Int? {
        if (sourceWidth <= 0 || sourceHeight <= 0 || sourceWidth > MAX_SIDE || sourceHeight > MAX_SIDE) return null
        var sample = 1
        while (sourceWidth / (sample * 2) >= width) sample *= 2
        return sample
    }
}
