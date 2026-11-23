package dev.octave.player.seam

import dev.octave.session.http.SessionId

// The port's launch request union (packages/core/src/domain/player-engine.ts, LaunchRequest), as LaunchRequestReader
// builds it from the argument map. It names a session by id only; the engine sends through the session module's one
// client, which adds what the session needs. Its debug form is redacted: it holds play-session and item ids.

enum class TrackType(val wire: String) { AUDIO("audio"), SUBTITLE("subtitle") }

enum class MediaKind(val wire: String) { VIDEOS("videos"), AUDIO("audio") }

// The port's MediaTrack, field for field.
class MediaTrack(
    val index: Int,
    val type: String,
    val displayTitle: String,
    val external: Boolean,
    val codec: String? = null,
    val language: String? = null,
    val deliveryUrl: String? = null,
    val title: String? = null,
    val channels: Int? = null,
    val isDefault: Boolean? = null,
    val isForced: Boolean? = null,
    val isHearingImpaired: Boolean? = null,
) {
    override fun toString(): String = "MediaTrack([redacted])"
}

sealed class LaunchRequest {
    abstract val session: SessionId
    abstract val startPositionSeconds: Double
    abstract val tracks: List<MediaTrack>
    abstract val audioStreamIndex: Int?
    abstract val subtitleStreamIndex: Int?

    final override fun toString(): String = "LaunchRequest([redacted])"

    class Original(
        override val session: SessionId,
        override val startPositionSeconds: Double,
        override val tracks: List<MediaTrack>,
        override val audioStreamIndex: Int?,
        override val subtitleStreamIndex: Int?,
        val url: String,
    ) : LaunchRequest()

    class Hls(
        override val session: SessionId,
        override val startPositionSeconds: Double,
        override val tracks: List<MediaTrack>,
        override val audioStreamIndex: Int?,
        override val subtitleStreamIndex: Int?,
        val masterUrl: String,
        val serverUrl: String,
        val mediaKind: MediaKind,
    ) : LaunchRequest()
}
