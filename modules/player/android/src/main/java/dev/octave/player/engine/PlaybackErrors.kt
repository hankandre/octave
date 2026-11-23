package dev.octave.player.engine

import dev.octave.player.seam.PlayerErrorCode
import dev.octave.session.http.HttpRefusal
import dev.octave.session.http.OctaveHttpException

// A playback failure as the port's code (docs/specs/T8-02.md, "Error codes"). A refusal of the one client is more
// exact than Media3's generic code, so the first OctaveHttpException in the cause chain wins (D7). Otherwise Media3's
// PlaybackException.ERROR_CODE_* number maps by range; the numbers are literals so this package needs no Media3 class,
// and PlaybackErrorsTest checks each against Media3's own constant. Nothing of a throwable but its class and refusal
// is read.
object PlaybackErrors {
    fun codeFor(mediaCode: Int, causes: List<Throwable>): PlayerErrorCode {
        val refusal = causes.firstNotNullOfOrNull { it as? OctaveHttpException }?.refusal
        if (refusal != null) return codeFor(refusal)
        return when (mediaCode) {
            2000, 2001, 2002, 2007 -> PlayerErrorCode.NETWORK
            2003, 2004, 2005, 2006, 2008 -> PlayerErrorCode.SERVER_ERROR
            3001, 3002, 3003, 3004 -> PlayerErrorCode.MALFORMED_MEDIA
            4001, 4002, 4003, 4006 -> PlayerErrorCode.DECODER_FAILED
            4004, 4005 -> PlayerErrorCode.DECODER_UNAVAILABLE
            5001, 5002, 5003, 5004 -> PlayerErrorCode.AUDIO_OUTPUT_FAILED
            in 6000..6008 -> PlayerErrorCode.UNSUPPORTED_REQUEST
            else -> PlayerErrorCode.UNKNOWN
        }
    }

    // A redirect is the server's fault (the port's comment on server-error); an ended session is session-ended; a
    // name that resolved to a public address is the network. Every other refusal is a request Octave will not send.
    private fun codeFor(refusal: HttpRefusal): PlayerErrorCode = when (refusal) {
        HttpRefusal.REDIRECT -> PlayerErrorCode.SERVER_ERROR
        HttpRefusal.NO_SESSION -> PlayerErrorCode.SESSION_ENDED
        HttpRefusal.RESOLVED_PUBLIC -> PlayerErrorCode.NETWORK
        else -> PlayerErrorCode.UNSUPPORTED_REQUEST
    }
}
