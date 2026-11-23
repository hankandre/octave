package dev.octave.player.seam

// Writes events and capabilities as the plain maps that cross to JavaScript, from their typed fields only. An
// optional field that is null is left out. Every string is cut to 256 characters; the core rebuilds every event
// again (packages/core/src/player/player-event.ts).
object PlayerEventMaps {
    private const val MAX_STRING = 256
    private val REASONS = setOf("eof", "stopped", "error")
    private val CAUSES = setOf("pause", "seek", "property")

    fun toMap(event: PlayerEvent): Map<String, Any?> {
        val map = linkedMapOf<String, Any?>("kind" to event.kind)
        when (event) {
            is PlayerEvent.Loaded -> map["snapshot"] = snapshot(event.snapshot)
            PlayerEvent.FirstFrame -> Unit
            is PlayerEvent.State -> {
                map["snapshot"] = snapshot(event.snapshot)
                if (event.cause in CAUSES) map["cause"] = event.cause
            }
            is PlayerEvent.TracksChanged -> map["snapshot"] = snapshot(event.snapshot)
            is PlayerEvent.Ended -> {
                map["reason"] = if (event.reason in REASONS) event.reason else "error"
                event.snapshot?.let { map["snapshot"] = snapshot(it) }
            }
            is PlayerEvent.Error -> map["code"] = event.code.wire
        }
        return map
    }

    fun toMap(capabilities: Capabilities): Map<String, Any?> = when (capabilities) {
        Capabilities.Failed -> mapOf("probe" to "failed")
        is Capabilities.Complete -> mapOf(
            "probe" to "complete",
            "videoDecoders" to capabilities.videoDecoders.map { decoder(it) },
            "audioDecoders" to capabilities.audioDecoders.map { cut(it) },
            "hdr" to capabilities.hdr.map { cut(it) },
            "passthrough" to capabilities.passthrough.map { cut(it) },
        )
    }

    private fun decoder(decoder: VideoDecoder): Map<String, Any?> {
        val map = linkedMapOf<String, Any?>("codec" to cut(decoder.codec), "hardware" to decoder.hardware)
        put(map, "profile", decoder.profile?.let { cut(it) })
        put(map, "maxBitDepth", decoder.maxBitDepth)
        put(map, "maxWidth", decoder.maxWidth)
        put(map, "maxHeight", decoder.maxHeight)
        return map
    }

    private fun snapshot(snapshot: PlaybackSnapshot): Map<String, Any?> {
        val map = linkedMapOf<String, Any?>("positionSeconds" to snapshot.positionSeconds)
        put(map, "durationSeconds", snapshot.durationSeconds)
        map["paused"] = snapshot.paused
        map["buffering"] = snapshot.buffering
        map["volume"] = snapshot.volume
        map["muted"] = snapshot.muted
        put(map, "audioTrack", snapshot.audioTrack)
        put(map, "subtitleTrack", snapshot.subtitleTrack)
        map["tracks"] = snapshot.tracks.map { track(it) }
        map["diagnostics"] = diagnostics(snapshot.diagnostics)
        put(map, "video", snapshot.video?.let { video(it) })
        put(map, "audio", snapshot.audio?.let { audio(it) })
        put(map, "bufferedSeconds", snapshot.bufferedSeconds)
        return map
    }

    private fun track(track: PlayerTrack): Map<String, Any?> {
        val map = linkedMapOf<String, Any?>("playerId" to track.playerId)
        put(map, "jellyfinIndex", track.jellyfinIndex)
        map["type"] = cut(track.type)
        map["title"] = cut(track.title)
        put(map, "language", track.language?.let { cut(it) })
        map["external"] = track.external
        map["selected"] = track.selected
        return map
    }

    private fun diagnostics(diagnostics: PlaybackDiagnostics): Map<String, Any?> {
        val map = linkedMapOf<String, Any?>("decodeMode" to cut(diagnostics.decodeMode), "decodeLabel" to cut(diagnostics.decodeLabel))
        put(map, "videoCodec", diagnostics.videoCodec?.let { cut(it) })
        put(map, "bitDepth", diagnostics.bitDepth)
        put(map, "width", diagnostics.width)
        put(map, "height", diagnostics.height)
        map["droppedFrames"] = diagnostics.droppedFrames
        return map
    }

    private fun video(video: VideoFacts): Map<String, Any?> {
        val map = linkedMapOf<String, Any?>()
        put(map, "codec", video.codec?.let { cut(it) })
        map["range"] = cut(video.range)
        put(map, "dolbyVisionProfile", video.dolbyVisionProfile)
        return map
    }

    private fun audio(audio: AudioFacts): Map<String, Any?> {
        val map = linkedMapOf<String, Any?>()
        put(map, "codec", audio.codec?.let { cut(it) })
        put(map, "channelCount", audio.channelCount)
        put(map, "sampleRate", audio.sampleRate)
        put(map, "outputChannelCount", audio.outputChannelCount)
        put(map, "output", audio.output?.let { cut(it) })
        put(map, "passthroughFormat", audio.passthroughFormat?.let { cut(it) })
        return map
    }

    private fun put(map: MutableMap<String, Any?>, key: String, value: Any?) {
        if (value != null) map[key] = value
    }

    private fun cut(text: String): String {
        if (text.length <= MAX_STRING) return text
        val end = if (Character.isHighSurrogate(text[MAX_STRING - 1])) MAX_STRING - 1 else MAX_STRING
        return text.substring(0, end)
    }
}
