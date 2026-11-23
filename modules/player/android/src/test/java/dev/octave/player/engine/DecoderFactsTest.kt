package dev.octave.player.engine

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

// T8-02 item 3 (docs/specs/T8-02.md, "Decoder facts"): DecoderFacts.read(name, hardwareAccelerated, softwareOnly,
// sdkInt) answers a value with `decodeMode` ("hardware", "software" or "unknown") and `decodeLabel` (the decoder's
// name, or "" with no decoder). Hardware or software comes only from what Media3 reports for that name on API 29 and
// later; below 29 Media3 guesses from the name, so the answer is unknown.
class DecoderFactsTest {
    private fun assertFacts(mode: String, label: String, name: String?, hardware: Boolean?, software: Boolean?, sdk: Int) {
        val facts = DecoderFacts.read(name, hardware, software, sdk)
        assertEquals(mode, facts.decodeMode, "decodeMode for $name, $hardware, $software, API $sdk")
        assertEquals(label, facts.decodeLabel, "decodeLabel for $name, $hardware, $software, API $sdk")
    }

    @Test
    fun no_decoder_yet_is_unknown_with_an_empty_label() {
        assertFacts("unknown", "", null, null, null, 36)
        assertFacts("unknown", "", null, true, false, 36)
    }

    @Test
    fun a_hardware_decoder_on_api_29_and_later_is_hardware() {
        assertFacts("hardware", "c2.qti.avc.decoder", "c2.qti.avc.decoder", true, false, 29)
        assertFacts("hardware", "OMX.amlogic.hevc.decoder.awesome2", "OMX.amlogic.hevc.decoder.awesome2", true, false, 36)
    }

    @Test
    fun a_software_decoder_on_api_29_and_later_is_software() {
        assertFacts("software", "c2.android.avc.decoder", "c2.android.avc.decoder", false, true, 29)
        assertFacts("software", "c2.android.av1.decoder", "c2.android.av1.decoder", false, true, 36)
    }

    @Test
    fun below_api_29_media3_guesses_so_it_is_unknown_with_the_name() {
        assertFacts("unknown", "OMX.google.h264.decoder", "OMX.google.h264.decoder", false, true, 28)
        assertFacts("unknown", "OMX.qcom.video.decoder.avc", "OMX.qcom.video.decoder.avc", true, false, 24)
    }

    @Test
    fun a_name_media3_has_no_info_for_is_unknown_with_the_name() {
        assertFacts("unknown", "c2.unlisted.decoder", "c2.unlisted.decoder", null, null, 36)
        assertFacts("unknown", "c2.half.listed.decoder", "c2.half.listed.decoder", true, null, 36)
        assertFacts("unknown", "c2.half.listed.decoder", "c2.half.listed.decoder", null, true, 36)
    }

    @Test
    fun flags_that_agree_are_unknown_with_the_name() {
        assertFacts("unknown", "c2.both.decoder", "c2.both.decoder", true, true, 36)
        assertFacts("unknown", "c2.neither.decoder", "c2.neither.decoder", false, false, 36)
    }
}
