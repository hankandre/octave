package dev.octave.player.engine

import dev.octave.player.seam.PlayerEngineException
import dev.octave.player.seam.PlayerErrorCode
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

// How the engine's commands reach the one thread its players live on (docs/specs/T8-02.md, "Threading"), in plain
// Kotlin so it is tested without a looper. A call runs inline when the caller is already on that thread; otherwise it
// is posted and the caller waits at most `waitMillis`.
// - Once `closed()` holds (the module was destroyed), a call that is not a stop is refused when it comes to run, so a
//   launch posted before the destroy builds no player.
// - When the caller stops waiting, a call that has not started never runs; one that was running, or runs late, runs
//   its `undoLate` right after it, so nothing it built outlives a command its caller saw fail.
class MainThreadGate(
    private val onMainThread: () -> Boolean,
    private val post: (Runnable) -> Unit,
    private val closed: () -> Boolean,
    private val waitMillis: Long,
) {
    fun run(undoLate: () -> Unit = {}, work: () -> Unit) = submit(Call(work, undoLate, refuseWhenClosed = true))

    // A stop: it runs even after the module was destroyed.
    fun runEvenWhenClosed(work: () -> Unit) = submit(Call(work, undoLate = {}, refuseWhenClosed = false))

    private fun submit(call: Call) {
        if (onMainThread()) {
            call.run()
        } else {
            post(call)
            call.await()
        }
        val failure = call.failure ?: return
        throw failure as? PlayerEngineException ?: PlayerEngineException(PlayerErrorCode.UNKNOWN)
    }

    private inner class Call(
        private val work: () -> Unit,
        private val undoLate: () -> Unit,
        private val refuseWhenClosed: Boolean,
    ) : Runnable {
        private val lock = Any()
        private val finished = CountDownLatch(1)
        private var state = PENDING

        // Written before `finished` counts down and read after it, or on the same thread.
        var failure: Throwable? = null
            private set

        override fun run() {
            synchronized(lock) {
                if (state == ABANDONED) return
                state = RUNNING
            }
            try {
                if (refuseWhenClosed && closed()) throw PlayerEngineException(PlayerErrorCode.UNKNOWN)
                work()
            } catch (thrown: Throwable) {
                failure = thrown
            }
            val late = synchronized(lock) {
                val abandoned = state == ABANDONED
                state = FINISHED
                abandoned
            }
            finished.countDown()
            if (late && failure == null) {
                try {
                    undoLate()
                } catch (_: Throwable) {
                    // Nobody waits on this call any more, and the player's thread must not die of it.
                }
            }
        }

        fun await() {
            if (finished.await(waitMillis, TimeUnit.MILLISECONDS)) return
            val gaveUp = synchronized(lock) {
                if (state == FINISHED) {
                    false
                } else {
                    state = ABANDONED
                    true
                }
            }
            if (gaveUp) throw PlayerEngineException(PlayerErrorCode.UNKNOWN)
        }
    }

    private companion object {
        const val PENDING = 0
        const val RUNNING = 1
        const val FINISHED = 2
        const val ABANDONED = 3
    }
}
