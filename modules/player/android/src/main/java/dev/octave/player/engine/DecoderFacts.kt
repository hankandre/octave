package dev.octave.player.engine

// The decoder facts of a snapshot (T8-02 item 3): the decoder's name, and hardware or software only as Media3 reports
// it for that name on API 29 and later, where it is the platform's MediaCodecInfo answer. Below 29 Media3 guesses
// from the name, so the mode is unknown.
class DecoderFacts(val decodeMode: String, val decodeLabel: String) {
    companion object {
        private const val PLATFORM_FLAGS_SDK = 29

        val NONE = DecoderFacts("unknown", "")

        fun read(name: String?, hardwareAccelerated: Boolean?, softwareOnly: Boolean?, sdkInt: Int): DecoderFacts {
            if (name == null) return NONE
            if (sdkInt < PLATFORM_FLAGS_SDK || hardwareAccelerated == null || softwareOnly == null) return DecoderFacts("unknown", name)
            val mode = when {
                hardwareAccelerated && !softwareOnly -> "hardware"
                softwareOnly && !hardwareAccelerated -> "software"
                else -> "unknown"
            }
            return DecoderFacts(mode, name)
        }
    }
}
