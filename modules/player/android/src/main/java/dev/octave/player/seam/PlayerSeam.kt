package dev.octave.player.seam

import dev.octave.session.http.SessionId

// Whether this process holds a session. In the app it is the session registry's answer (RegistrySessionCheck); the
// seam learns nothing else about a session.
fun interface SessionCheck {
    fun holds(session: SessionId): Boolean
}

// The player module's six commands as plain Kotlin (docs/specs/T8-01.md, "PlayerSeam behaviour"). Each takes at most
// one argument map and answers one map: {} or { error: code }. Every call catches Throwable and reads nothing of it
// but a PlayerEngineException's code, so no player text, URL or path crosses. With no engine, initialize answers
// "cannot tell", a command answers unsupported-request, and stop completes.
class PlayerSeam(
    private val engine: PlaybackEngine?,
    private val sessions: SessionCheck,
    private val emit: (Map<String, Any?>) -> Unit,
) {
    fun initialize(): Map<String, Any?> {
        val engine = engine ?: return FAILED
        return try {
            engine.setListener { event -> deliver(event) }
            PlayerEventMaps.toMap(engine.capabilities())
        } catch (_: Throwable) {
            FAILED
        }
    }

    // In order: the map's shape, then the session, then the engine.
    fun launch(args: Map<String, Any?>): Map<String, Any?> = guard {
        val request = LaunchRequestReader.read(args) ?: return@guard UNSUPPORTED
        if (!sessions.holds(request.session)) return@guard SESSION_ENDED
        val engine = engine ?: return@guard UNSUPPORTED
        engine.launch(request)
        OK
    }

    fun setPaused(args: Map<String, Any?>): Map<String, Any?> = guard {
        if (args.keys != setOf("paused")) return@guard UNSUPPORTED
        val paused = args["paused"] as? Boolean ?: return@guard UNSUPPORTED
        val engine = engine ?: return@guard UNSUPPORTED
        engine.setPaused(paused)
        OK
    }

    fun seek(args: Map<String, Any?>): Map<String, Any?> = guard {
        if (args.keys != setOf("positionSeconds")) return@guard UNSUPPORTED
        val position = LaunchRequestReader.finite(args["positionSeconds"]) ?: return@guard UNSUPPORTED
        if (position < 0.0) return@guard UNSUPPORTED
        val engine = engine ?: return@guard UNSUPPORTED
        engine.seek(position)
        OK
    }

    fun selectTrack(args: Map<String, Any?>): Map<String, Any?> = guard {
        if (!SELECT_TRACK_KEYS.containsAll(args.keys)) return@guard UNSUPPORTED
        val type = when (args["type"]) {
            "audio" -> TrackType.AUDIO
            "subtitle" -> TrackType.SUBTITLE
            else -> return@guard UNSUPPORTED
        }
        val playerId = if (args["playerId"] == null) {
            null
        } else {
            LaunchRequestReader.integer(args["playerId"])?.takeIf { it >= 0 } ?: return@guard UNSUPPORTED
        }
        val engine = engine ?: return@guard UNSUPPORTED
        engine.selectTrack(type, playerId)
        OK
    }

    fun stop(): Map<String, Any?> = guard {
        engine?.stop()
        OK
    }

    private fun deliver(event: PlayerEvent) {
        try {
            emit(PlayerEventMaps.toMap(event))
        } catch (_: Throwable) {
            // An event that cannot be written or sent is dropped; nothing of it is kept.
        }
    }

    private inline fun guard(call: () -> Map<String, Any?>): Map<String, Any?> = try {
        call()
    } catch (failure: PlayerEngineException) {
        mapOf("error" to failure.code.wire)
    } catch (_: Throwable) {
        UNKNOWN
    }

    private companion object {
        val OK: Map<String, Any?> = emptyMap()
        val FAILED: Map<String, Any?> = mapOf("probe" to "failed")
        val UNSUPPORTED: Map<String, Any?> = mapOf("error" to PlayerErrorCode.UNSUPPORTED_REQUEST.wire)
        val SESSION_ENDED: Map<String, Any?> = mapOf("error" to PlayerErrorCode.SESSION_ENDED.wire)
        val UNKNOWN: Map<String, Any?> = mapOf("error" to PlayerErrorCode.UNKNOWN.wire)
        val SELECT_TRACK_KEYS = setOf("type", "playerId")
    }
}
