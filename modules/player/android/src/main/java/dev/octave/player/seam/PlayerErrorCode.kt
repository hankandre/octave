package dev.octave.player.seam

// The port's PLAYER_ERROR_CODES (packages/core/src/domain/player-engine.ts), in its order. A failure crosses to
// JavaScript as one of these wire names and nothing else.
enum class PlayerErrorCode(val wire: String) {
    NETWORK("network"),
    SERVER_ERROR("server-error"),
    SESSION_ENDED("session-ended"),
    UNSAFE_PLAYLIST("unsafe-playlist"),
    UNSUPPORTED_REQUEST("unsupported-request"),
    MALFORMED_MEDIA("malformed-media"),
    DECODER_UNAVAILABLE("decoder-unavailable"),
    DECODER_FAILED("decoder-failed"),
    AUDIO_OUTPUT_FAILED("audio-output-failed"),
    STOP_FAILED("stop-failed"),
    UNKNOWN("unknown"),
    ;
}

// An engine's typed failure. It carries the code and no cause, so no player text, URL or path rides along.
class PlayerEngineException(val code: PlayerErrorCode) : Exception(code.wire)
