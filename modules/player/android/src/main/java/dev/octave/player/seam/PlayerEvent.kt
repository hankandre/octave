package dev.octave.player.seam

// The port's six player events (packages/core/src/domain/player-engine.ts, PlayerEvent), with its wire names. No
// type here has a URL, path or message field, so an engine cannot hand one to an event.
sealed class PlayerEvent(val kind: String) {
    class Loaded(val snapshot: PlaybackSnapshot) : PlayerEvent("loaded")

    object FirstFrame : PlayerEvent("first-frame")

    // `cause` is "pause", "seek" or "property"; any other value is left out of the map.
    class State(val snapshot: PlaybackSnapshot, val cause: String? = null) : PlayerEvent("state")

    class TracksChanged(val snapshot: PlaybackSnapshot) : PlayerEvent("tracks-changed")

    // `reason` is "eof", "stopped" or "error"; any other value is written as "error".
    class Ended(val reason: String, val snapshot: PlaybackSnapshot? = null) : PlayerEvent("ended")

    class Error(val code: PlayerErrorCode) : PlayerEvent("error")
}

// The port's PlaybackSnapshot and the interfaces it holds, with the port's field names and optionality. Seconds and
// the volume are Double; counts, indices, sizes, bit depths, rates and player ids are Int; string unions are String.
class PlaybackSnapshot(
    val positionSeconds: Double,
    val durationSeconds: Double?,
    val paused: Boolean,
    val buffering: Boolean,
    val volume: Double,
    val muted: Boolean,
    val audioTrack: Int?,
    val subtitleTrack: Int?,
    val tracks: List<PlayerTrack>,
    val diagnostics: PlaybackDiagnostics,
    val video: VideoFacts?,
    val audio: AudioFacts?,
    val bufferedSeconds: Double?,
)

class PlayerTrack(
    val playerId: Int,
    val jellyfinIndex: Int?,
    val type: String,
    val title: String,
    val language: String?,
    val external: Boolean,
    val selected: Boolean,
)

class PlaybackDiagnostics(
    val decodeMode: String,
    val decodeLabel: String,
    val videoCodec: String?,
    val bitDepth: Int?,
    val width: Int?,
    val height: Int?,
    val droppedFrames: Int,
)

class VideoFacts(val codec: String?, val range: String, val dolbyVisionProfile: Int?)

class AudioFacts(
    val codec: String?,
    val channelCount: Int?,
    val sampleRate: Int?,
    val outputChannelCount: Int?,
    val output: String?,
    val passthroughFormat: String?,
)
