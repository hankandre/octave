package dev.octave.player.seam

import java.io.File

// A PlaybackEngine for the frozen T8-01 tests (docs/specs/T8-01.md, "The Kotlin seam"). It records every call, throws
// `failure` from every member when set, and emits through the listener the seam gave it. It sends nothing and logs
// nothing.
class FakeEngine(var capabilitiesAnswer: Capabilities = Capabilities.Failed) : PlaybackEngine {
    val calls = mutableListOf<String>()
    val launched = mutableListOf<LaunchRequest>()
    var listener: ((PlayerEvent) -> Unit)? = null
    var failure: Throwable? = null
    // Runs inside launch, after the request is recorded, before `failure` is thrown.
    var onLaunch: (FakeEngine) -> Unit = {}

    override fun capabilities(): Capabilities {
        calls += "capabilities"
        failure?.let { throw it }
        return capabilitiesAnswer
    }

    override fun setListener(listener: ((PlayerEvent) -> Unit)?) {
        calls += "setListener"
        this.listener = listener
    }

    override fun launch(request: LaunchRequest) {
        calls += "launch"
        launched += request
        onLaunch(this)
        failure?.let { throw it }
    }

    override fun setPaused(paused: Boolean) {
        calls += "setPaused:$paused"
        failure?.let { throw it }
    }

    override fun seek(positionSeconds: Double) {
        calls += "seek:$positionSeconds"
        failure?.let { throw it }
    }

    override fun selectTrack(type: TrackType, playerId: Int?) {
        calls += "selectTrack:${type.wire}:$playerId"
        failure?.let { throw it }
    }

    override fun stop() {
        calls += "stop"
        failure?.let { throw it }
    }

    fun emit(event: PlayerEvent) {
        listener?.invoke(event)
    }
}

// Values the seam's tests share. The typed event classes take the port's field names (packages/core/src/domain/
// player-engine.ts); the numbers this file freezes are Double for seconds and the volume, Int for every count, index,
// size, bit depth, rate and player id, and String for every value the port spells as a string union.
object Samples {
    const val SESSION = "3f1c9a7e5b2d4c6e8a0b1c2d3e4f5a6b"
    const val ORIGINAL_URL = "https://media.test/Videos/a1b2c3d4/stream?Static=true&MediaSourceId=a1b2c3d4"
    const val SUBTITLE_URL = "https://media.test/Videos/a1b2c3d4/a1b2c3d4/Subtitles/3/0/Stream.vtt"
    const val MASTER_URL = "https://media.test/jellyfin/videos/a1b2c3d4/master.m3u8?MediaSourceId=a1b2c3d4"
    const val SERVER_URL = "https://media.test/jellyfin"

    val repoRoot: File
        get() = File(checkNotNull(System.getProperty("octave.repoRoot")) { "system property octave.repoRoot is not set; run the tests through pnpm tv:native:test" })

    fun audioTrack(): MutableMap<String, Any?> =
        mutableMapOf("index" to 1.0, "type" to "Audio", "displayTitle" to "English - AAC - Stereo", "external" to false)

    fun subtitleTrack(url: String = SUBTITLE_URL): MutableMap<String, Any?> = mutableMapOf(
        "index" to 3.0,
        "type" to "Subtitle",
        "displayTitle" to "English - SRT",
        "external" to true,
        "codec" to "srt",
        "language" to "eng",
        "deliveryUrl" to url,
        "title" to "Full",
        "channels" to 2.0,
        "isDefault" to false,
        "isForced" to false,
        "isHearingImpaired" to true,
    )

    // An original-file launch map as Expo hands it over: numbers as Double, every optional key present.
    fun original(url: String = ORIGINAL_URL, session: String = SESSION): MutableMap<String, Any?> = mutableMapOf(
        "kind" to "original",
        "url" to url,
        "sessionId" to session,
        "startPositionSeconds" to 12.5,
        "tracks" to listOf(audioTrack(), subtitleTrack()),
        "audioStreamIndex" to 1.0,
        "subtitleStreamIndex" to 3.0,
    )

    // An original-file launch map with no optional key.
    fun minimalOriginal(): MutableMap<String, Any?> =
        mutableMapOf("kind" to "original", "url" to ORIGINAL_URL, "sessionId" to SESSION, "startPositionSeconds" to 0.0, "tracks" to listOf<Any?>())

    fun hls(): MutableMap<String, Any?> = mutableMapOf(
        "kind" to "hls",
        "masterUrl" to MASTER_URL,
        "serverUrl" to SERVER_URL,
        "mediaKind" to "videos",
        "sessionId" to SESSION,
        "startPositionSeconds" to 60.0,
        "tracks" to listOf(audioTrack(), subtitleTrack("https://media.test/jellyfin/Videos/a1b2c3d4/a1b2c3d4/Subtitles/3/0/Stream.vtt")),
        "audioStreamIndex" to 1.0,
        "subtitleStreamIndex" to -1.0,
    )

    fun minimalHls(): MutableMap<String, Any?> = mutableMapOf(
        "kind" to "hls",
        "masterUrl" to MASTER_URL,
        "serverUrl" to SERVER_URL,
        "mediaKind" to "audio",
        "sessionId" to SESSION,
        "startPositionSeconds" to 0.0,
        "tracks" to listOf<Any?>(),
    )

    fun playerTrack(title: String = "English", language: String? = "eng"): PlayerTrack =
        PlayerTrack(playerId = 2, jellyfinIndex = 1, type = "Audio", title = title, language = language, external = false, selected = true)

    fun diagnostics(decodeLabel: String = "c2.example.hevc.decoder", videoCodec: String? = "hevc"): PlaybackDiagnostics =
        PlaybackDiagnostics(decodeMode = "hardware", decodeLabel = decodeLabel, videoCodec = videoCodec, bitDepth = 10, width = 3840, height = 2160, droppedFrames = 3)

    // A snapshot with every optional field set.
    fun fullSnapshot(
        decodeLabel: String = "c2.example.hevc.decoder",
        trackTitle: String = "English",
        codec: String = "hevc",
    ): PlaybackSnapshot = PlaybackSnapshot(
        positionSeconds = 61.5,
        durationSeconds = 5400.0,
        paused = false,
        buffering = true,
        volume = 100.0,
        muted = false,
        audioTrack = 2,
        subtitleTrack = 5,
        tracks = listOf(playerTrack(title = trackTitle, language = "eng")),
        diagnostics = diagnostics(decodeLabel = decodeLabel, videoCodec = codec),
        video = VideoFacts(codec = codec, range = "pq", dolbyVisionProfile = 8),
        audio = AudioFacts(codec = "eac3", channelCount = 6, sampleRate = 48000, outputChannelCount = 6, output = "passthrough", passthroughFormat = "eac3"),
        bufferedSeconds = 75.0,
    )

    // A snapshot with every optional field left out.
    fun bareSnapshot(): PlaybackSnapshot = PlaybackSnapshot(
        positionSeconds = 0.0,
        durationSeconds = null,
        paused = true,
        buffering = false,
        volume = 100.0,
        muted = false,
        audioTrack = null,
        subtitleTrack = null,
        tracks = listOf(PlayerTrack(playerId = 0, jellyfinIndex = null, type = "Video", title = "Video", language = null, external = false, selected = true)),
        diagnostics = PlaybackDiagnostics(decodeMode = "unknown", decodeLabel = "", videoCodec = null, bitDepth = null, width = null, height = null, droppedFrames = 0),
        video = null,
        audio = null,
        bufferedSeconds = null,
    )

    // One event of each of the port's six kinds.
    fun everyKind(): List<PlayerEvent> = listOf(
        PlayerEvent.Loaded(fullSnapshot()),
        PlayerEvent.FirstFrame,
        PlayerEvent.State(fullSnapshot(), "pause"),
        PlayerEvent.TracksChanged(fullSnapshot()),
        PlayerEvent.Ended(reason = "eof", snapshot = fullSnapshot()),
        PlayerEvent.Error(PlayerErrorCode.NETWORK),
    )

    fun code(wire: String): PlayerErrorCode = enumValues<PlayerErrorCode>().single { it.wire == wire }
}
