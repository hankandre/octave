package dev.octave.player.seam

// The port's PlayerCapabilities: what an engine probed, or "cannot tell" (Failed), never "can play".
sealed class Capabilities {
    object Failed : Capabilities()

    class Complete(
        val videoDecoders: List<VideoDecoder>,
        val audioDecoders: List<String>,
        val hdr: List<String>,
        val passthrough: List<String>,
    ) : Capabilities()
}

// The port's VideoDecoder, field for field.
class VideoDecoder(
    val codec: String,
    val hardware: Boolean,
    val profile: String? = null,
    val maxBitDepth: Int? = null,
    val maxWidth: Int? = null,
    val maxHeight: Int? = null,
)
