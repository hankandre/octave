package dev.octave.player.engine

import androidx.media3.common.PlaybackException
import dev.octave.player.seam.PlayerErrorCode
import dev.octave.session.http.HttpRefusal
import dev.octave.session.http.OctaveHttpException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.IOException

// T8-02 items 5 and 6 (docs/specs/T8-02.md, "Error codes"): PlaybackErrors.codeFor(mediaCode, causes) answers the
// port's PlayerErrorCode. The first OctaveHttpException in the cause list wins over Media3's code; otherwise Media3's
// code maps by the table. The table's numbers are literals in engine/; each is checked here against Media3's own
// PlaybackException.ERROR_CODE_* constant (read from media3-common 1.11.1), so a Media3 upgrade that renumbers fails.
// Test names group by item: cause_chain_* and refusal_* (item 5), decoder_* (item 6), media3_code_* (the table).
class PlaybackErrorsTest {
    private fun codeFor(mediaCode: Int, vararg causes: Throwable): PlayerErrorCode = PlaybackErrors.codeFor(mediaCode, causes.toList())

    // ---- item 5 ----

    @Test
    fun cause_chain_redirect_wins_over_media3_network_code() {
        assertEquals(PlayerErrorCode.SERVER_ERROR, codeFor(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED, OctaveHttpException(HttpRefusal.REDIRECT)))
        assertEquals(
            PlayerErrorCode.SERVER_ERROR,
            codeFor(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED, IOException("wrapper"), OctaveHttpException(HttpRefusal.REDIRECT)),
        )
        assertEquals(PlayerErrorCode.SERVER_ERROR, codeFor(PlaybackException.ERROR_CODE_IO_UNSPECIFIED, RuntimeException("x"), OctaveHttpException(HttpRefusal.REDIRECT)))
    }

    @Test
    fun cause_chain_first_refusal_wins() {
        assertEquals(
            PlayerErrorCode.SESSION_ENDED,
            codeFor(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED, OctaveHttpException(HttpRefusal.NO_SESSION), OctaveHttpException(HttpRefusal.REDIRECT)),
        )
    }

    @Test
    fun cause_chain_without_a_refusal_falls_back_to_media3_code() {
        assertEquals(PlayerErrorCode.NETWORK, codeFor(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED, IOException("reset")))
        assertEquals(PlayerErrorCode.SERVER_ERROR, codeFor(PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS, IOException("404")))
    }

    @Test
    fun refusal_every_http_refusal_has_a_code() {
        val named = mapOf(
            HttpRefusal.REDIRECT to PlayerErrorCode.SERVER_ERROR,
            HttpRefusal.NO_SESSION to PlayerErrorCode.SESSION_ENDED,
            HttpRefusal.RESOLVED_PUBLIC to PlayerErrorCode.NETWORK,
        )
        for (refusal in HttpRefusal.entries) {
            val expected = named[refusal] ?: PlayerErrorCode.UNSUPPORTED_REQUEST
            assertEquals(expected, codeFor(PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED, OctaveHttpException(refusal)), refusal.code)
            assertEquals(expected, codeFor(PlaybackException.ERROR_CODE_UNSPECIFIED, OctaveHttpException(refusal)), refusal.code)
        }
    }

    // ---- item 6 ----

    @Test
    fun decoder_format_codes_are_decoder_unavailable() {
        assertEquals(PlayerErrorCode.DECODER_UNAVAILABLE, codeFor(PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES))
        assertEquals(PlayerErrorCode.DECODER_UNAVAILABLE, codeFor(PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED))
    }

    @Test
    fun decoder_failures_are_decoder_failed() {
        for (code in listOf(
            PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
            PlaybackException.ERROR_CODE_DECODER_QUERY_FAILED,
            PlaybackException.ERROR_CODE_DECODING_FAILED,
            PlaybackException.ERROR_CODE_DECODING_RESOURCES_RECLAIMED,
        )) {
            assertEquals(PlayerErrorCode.DECODER_FAILED, codeFor(code), "$code")
        }
    }

    // ---- the whole table ----

    @Test
    fun media3_code_table_matches_media3_constants() {
        val table = listOf(
            PlaybackException.ERROR_CODE_IO_UNSPECIFIED to PlayerErrorCode.NETWORK,
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED to PlayerErrorCode.NETWORK,
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT to PlayerErrorCode.NETWORK,
            PlaybackException.ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE to PlayerErrorCode.SERVER_ERROR,
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS to PlayerErrorCode.SERVER_ERROR,
            PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND to PlayerErrorCode.SERVER_ERROR,
            PlaybackException.ERROR_CODE_IO_NO_PERMISSION to PlayerErrorCode.SERVER_ERROR,
            PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE to PlayerErrorCode.SERVER_ERROR,
            PlaybackException.ERROR_CODE_IO_CLEARTEXT_NOT_PERMITTED to PlayerErrorCode.NETWORK,
            PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED to PlayerErrorCode.MALFORMED_MEDIA,
            PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED to PlayerErrorCode.MALFORMED_MEDIA,
            PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED to PlayerErrorCode.MALFORMED_MEDIA,
            PlaybackException.ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED to PlayerErrorCode.MALFORMED_MEDIA,
            PlaybackException.ERROR_CODE_DECODER_INIT_FAILED to PlayerErrorCode.DECODER_FAILED,
            PlaybackException.ERROR_CODE_DECODER_QUERY_FAILED to PlayerErrorCode.DECODER_FAILED,
            PlaybackException.ERROR_CODE_DECODING_FAILED to PlayerErrorCode.DECODER_FAILED,
            PlaybackException.ERROR_CODE_DECODING_RESOURCES_RECLAIMED to PlayerErrorCode.DECODER_FAILED,
            PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES to PlayerErrorCode.DECODER_UNAVAILABLE,
            PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED to PlayerErrorCode.DECODER_UNAVAILABLE,
            PlaybackException.ERROR_CODE_AUDIO_TRACK_INIT_FAILED to PlayerErrorCode.AUDIO_OUTPUT_FAILED,
            PlaybackException.ERROR_CODE_AUDIO_TRACK_WRITE_FAILED to PlayerErrorCode.AUDIO_OUTPUT_FAILED,
            PlaybackException.ERROR_CODE_AUDIO_TRACK_OFFLOAD_WRITE_FAILED to PlayerErrorCode.AUDIO_OUTPUT_FAILED,
            PlaybackException.ERROR_CODE_AUDIO_TRACK_OFFLOAD_INIT_FAILED to PlayerErrorCode.AUDIO_OUTPUT_FAILED,
            PlaybackException.ERROR_CODE_DRM_UNSPECIFIED to PlayerErrorCode.UNSUPPORTED_REQUEST,
            PlaybackException.ERROR_CODE_DRM_SCHEME_UNSUPPORTED to PlayerErrorCode.UNSUPPORTED_REQUEST,
            PlaybackException.ERROR_CODE_DRM_PROVISIONING_FAILED to PlayerErrorCode.UNSUPPORTED_REQUEST,
            PlaybackException.ERROR_CODE_DRM_CONTENT_ERROR to PlayerErrorCode.UNSUPPORTED_REQUEST,
            PlaybackException.ERROR_CODE_DRM_LICENSE_ACQUISITION_FAILED to PlayerErrorCode.UNSUPPORTED_REQUEST,
            PlaybackException.ERROR_CODE_DRM_DISALLOWED_OPERATION to PlayerErrorCode.UNSUPPORTED_REQUEST,
            PlaybackException.ERROR_CODE_DRM_SYSTEM_ERROR to PlayerErrorCode.UNSUPPORTED_REQUEST,
            PlaybackException.ERROR_CODE_DRM_DEVICE_REVOKED to PlayerErrorCode.UNSUPPORTED_REQUEST,
            PlaybackException.ERROR_CODE_DRM_LICENSE_EXPIRED to PlayerErrorCode.UNSUPPORTED_REQUEST,
            PlaybackException.ERROR_CODE_UNSPECIFIED to PlayerErrorCode.UNKNOWN,
            PlaybackException.ERROR_CODE_REMOTE_ERROR to PlayerErrorCode.UNKNOWN,
            PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW to PlayerErrorCode.UNKNOWN,
            PlaybackException.ERROR_CODE_TIMEOUT to PlayerErrorCode.UNKNOWN,
            PlaybackException.ERROR_CODE_FAILED_RUNTIME_CHECK to PlayerErrorCode.UNKNOWN,
            PlaybackException.ERROR_CODE_VIDEO_FRAME_PROCESSOR_INIT_FAILED to PlayerErrorCode.UNKNOWN,
            PlaybackException.ERROR_CODE_VIDEO_FRAME_PROCESSING_FAILED to PlayerErrorCode.UNKNOWN,
            PlaybackException.ERROR_CODE_INVALID_STATE to PlayerErrorCode.UNKNOWN,
            PlaybackException.ERROR_CODE_DISCONNECTED to PlayerErrorCode.UNKNOWN,
            PlaybackException.ERROR_CODE_CONTENT_ALREADY_PLAYING to PlayerErrorCode.UNKNOWN,
        )
        for ((code, expected) in table) assertEquals(expected, codeFor(code), "Media3 code $code")
    }

    @Test
    fun media3_code_unknown_number_is_unknown() {
        for (code in listOf(0, 1, 999, 2009, 3000, 4000, 4007, 5000, 5005, 6009, 7002, 9999, -1, -111)) {
            assertEquals(PlayerErrorCode.UNKNOWN, codeFor(code), "code $code")
        }
    }
}
