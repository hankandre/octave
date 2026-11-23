package dev.octave.player

// The state behind VideoSurfaceSlot, in plain Kotlin so it is tested on the JVM. It holds every surface offered and
// not yet withdrawn, newest last; the current one is the newest. When the newest is withdrawn, the one offered
// before it (still valid, for example the older view during a screen transition) becomes current again.
//
// Contract for the listener: it runs under this slot's lock, on the thread that changed the slot (the UI thread for
// surfaceCreated and surfaceDestroyed), so that an engine can clear a surface before surfaceDestroyed returns. It
// must therefore not wait on another thread that may call into this slot (setListener included); an engine that
// needs its playback thread hands the surface over without waiting for a thread that takes this lock.
internal class SurfaceSlot<S : Any> {
    private val offered = ArrayList<S>()
    private var listener: ((S?) -> Unit)? = null

    private val current: S?
        get() = offered.lastOrNull()

    @Synchronized
    fun offer(surface: S) {
        offered.removeAll { it === surface }
        offered.add(surface)
        listener?.invoke(surface)
    }

    // Withdraws a surface; the listener hears a change only when it was the current one.
    @Synchronized
    fun withdraw(surface: S) {
        val wasCurrent = current === surface
        if (!offered.removeAll { it === surface } || !wasCurrent) return
        listener?.invoke(current)
    }

    // The engine's one listener; it hears the current surface at once, then every change.
    @Synchronized
    fun setListener(listener: ((S?) -> Unit)?) {
        this.listener = listener
        listener?.invoke(current)
    }
}
