package dev.octave.player.seam

// The engine behind the player module: the PlayerEngine port (packages/core/src/domain/player-engine.ts) in plain
// Kotlin. It names no Android, Expo, player-library or HTTP type, so a Swift engine can mirror it. An engine sends
// through the session module's one client for the request's session and never sees what that client adds. It fails
// with PlayerEngineException; anything else it throws crosses as "unknown". Ships with no implementation until T8-02.
interface PlaybackEngine {
    // The port's initialize: what this device can play, or Capabilities.Failed when it cannot tell.
    fun capabilities(): Capabilities

    // The port's subscribe: the one listener for every event, or null to drop it.
    fun setListener(listener: ((PlayerEvent) -> Unit)?)

    fun launch(request: LaunchRequest)

    fun setPaused(paused: Boolean)

    fun seek(positionSeconds: Double)

    fun selectTrack(type: TrackType, playerId: Int?)

    fun stop()
}
