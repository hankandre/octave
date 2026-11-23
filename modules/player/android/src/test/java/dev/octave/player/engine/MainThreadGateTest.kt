package dev.octave.player.engine

import dev.octave.player.seam.PlayerEngineException
import dev.octave.player.seam.PlayerErrorCode
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

// T8-02 review findings (docs/specs/T8-02.md, "Threading"): a launch still on its way to the main thread when the
// module is destroyed builds no player, and a launch whose caller stopped waiting is undone when it finishes late.
// The test thread plays the main looper: it runs what the gate posts, when the test says. Not frozen.
class MainThreadGateTest {
    private val mainThread = Thread.currentThread()
    private val posted = LinkedBlockingQueue<Runnable>()

    @Volatile
    private var closed = false

    private fun gate(waitMillis: Long = 5_000L) = MainThreadGate(
        onMainThread = { Thread.currentThread() === mainThread },
        post = { work -> posted.put(work) },
        closed = { closed },
        waitMillis = waitMillis,
    )

    // A caller on another thread (CommandQueue's); its outcome is null when the call returned, else the code it threw.
    private class Caller(call: () -> Unit) {
        val outcome = AtomicReference<Any?>(null)
        private val worker = thread {
            try {
                call()
                outcome.set(RETURNED)
            } catch (failure: PlayerEngineException) {
                outcome.set(failure.code)
            }
        }

        fun join(): Any? {
            worker.join(5_000L)
            assertFalse(worker.isAlive, "the caller returned")
            return outcome.get()
        }

        companion object {
            const val RETURNED = "returned"
        }
    }

    private fun nextPosted(): Runnable = checkNotNull(posted.poll(5, TimeUnit.SECONDS)) { "the gate posted the call" }

    @Test
    fun a_call_on_the_main_thread_runs_inline_and_posts_nothing() {
        var ran = false
        gate().run { ran = true }
        assertTrue(ran)
        assertTrue(posted.isEmpty())
    }

    @Test
    fun a_call_from_another_thread_is_posted_and_its_caller_waits_for_it() {
        val gate = gate()
        var ran = false
        val caller = Caller { gate.run { ran = true } }
        nextPosted().run()
        assertEquals(Caller.RETURNED, caller.join())
        assertTrue(ran)
    }

    @Test
    fun a_launch_posted_before_the_module_was_destroyed_never_runs_its_work() {
        val gate = gate()
        var built = false
        var undone = false
        val launch = Caller { gate.run(undoLate = { undone = true }) { built = true } }
        val queued = nextPosted()
        // OnDestroy on the main thread: the module is marked destroyed, then the inline stop finds nothing to stop.
        closed = true
        var stopped = false
        gate.runEvenWhenClosed { stopped = true }
        assertTrue(stopped, "the stop runs inline, after the destroy")
        queued.run()
        assertFalse(built, "the launch built nothing")
        assertFalse(undone)
        assertEquals(PlayerErrorCode.UNKNOWN, launch.join())
    }

    @Test
    fun every_call_but_a_stop_is_refused_once_closed() {
        closed = true
        val gate = gate()
        var ran = false
        val refused = runCatching { gate.run { ran = true } }.exceptionOrNull()
        assertEquals(PlayerErrorCode.UNKNOWN, (refused as PlayerEngineException).code)
        assertFalse(ran)
        var stopped = false
        gate.runEvenWhenClosed { stopped = true }
        assertTrue(stopped)
    }

    @Test
    fun a_call_whose_caller_gave_up_before_it_started_never_runs() {
        val gate = gate(waitMillis = 50L)
        var ran = false
        var undone = false
        val caller = Caller { gate.run(undoLate = { undone = true }) { ran = true } }
        assertEquals(PlayerErrorCode.UNKNOWN, caller.join())
        nextPosted().run()
        assertFalse(ran)
        assertFalse(undone)
    }

    @Test
    fun a_launch_that_finishes_after_its_caller_gave_up_is_undone() {
        val gate = gate(waitMillis = 50L)
        val running = CountDownLatch(1)
        val release = CountDownLatch(1)
        var built = false
        var undone = false
        val caller = Caller {
            gate.run(undoLate = { undone = true }) {
                running.countDown()
                release.await(5, TimeUnit.SECONDS)
                built = true
            }
        }
        val queued = nextPosted()
        // The main thread runs the launch on a helper so the test can hold it while the caller times out.
        val main = thread { queued.run() }
        assertTrue(running.await(5, TimeUnit.SECONDS))
        assertEquals(PlayerErrorCode.UNKNOWN, caller.join(), "the caller sees a failed launch")
        release.countDown()
        main.join(5_000L)
        assertTrue(built)
        assertTrue(undone, "what the late launch built is undone")
    }

    @Test
    fun a_call_that_finishes_in_time_is_not_undone() {
        val gate = gate()
        var undone = false
        val caller = Caller { gate.run(undoLate = { undone = true }) { } }
        nextPosted().run()
        assertEquals(Caller.RETURNED, caller.join())
        assertFalse(undone)
    }

    @Test
    fun a_typed_failure_crosses_as_its_code_and_any_other_as_unknown() {
        val gate = gate()
        val typed = Caller { gate.run { throw PlayerEngineException(PlayerErrorCode.UNSUPPORTED_REQUEST) } }
        nextPosted().run()
        assertEquals(PlayerErrorCode.UNSUPPORTED_REQUEST, typed.join())
        val other = runCatching { gate.run { error("boom") } }.exceptionOrNull()
        assertEquals(PlayerErrorCode.UNKNOWN, (other as PlayerEngineException).code)
        assertNull(runCatching { gate.run { } }.exceptionOrNull())
    }
}
