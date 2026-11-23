package dev.octave.player.engine

import dev.octave.player.seam.Capabilities

// The port's initialize behind any engine (T8-07 item 5, D7): reads the platform afresh on every call and answers
// "cannot tell" when the read throws anything, answers null (no context, a destroyed module), or leaves no video
// decoder. It never answers "can play" for a failure.
class CapabilityProbe(private val read: () -> PlatformReport?) {
    fun probe(): Capabilities = try {
        read()?.let(CapabilityMap::capabilities) ?: Capabilities.Failed
    } catch (_: Throwable) {
        Capabilities.Failed
    }
}
