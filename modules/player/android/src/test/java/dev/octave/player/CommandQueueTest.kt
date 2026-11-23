package dev.octave.player

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

// T8-01 review: every command the module queues answers exactly once, including one still queued, or sent, after the
// module is destroyed, so a JavaScript await never hangs.
class CommandQueueTest {
    private val unknown = mapOf("error" to "unknown")

    private class Answers {
        val values = ConcurrentLinkedQueue<Map<String, Any?>>()
        private val latch = CountDownLatch(1)
        fun take(value: Map<String, Any?>) {
            values += value
            latch.countDown()
        }
        fun await(): Map<String, Any?> {
            assertTrue(latch.await(5, TimeUnit.SECONDS), "the command answered")
            return values.single()
        }
    }

    @Test
    fun a_command_answers_its_result_and_a_throwing_one_unknown() {
        val queue = CommandQueue()
        val ok = Answers()
        val thrown = Answers()
        queue.run(ok::take) { mapOf("ok" to true) }
        queue.run(thrown::take) { error("player text") }
        assertEquals(mapOf("ok" to true), ok.await())
        assertEquals(unknown, thrown.await())
        queue.close()
    }

    @Test
    fun a_command_sent_after_close_answers_unknown() {
        val queue = CommandQueue()
        queue.close()
        val answers = Answers()
        queue.run(answers::take) { mapOf("ok" to true) }
        assertEquals(unknown, answers.await())
    }

    @Test
    fun a_command_queued_when_the_queue_closes_answers_unknown_and_the_running_one_its_result() {
        val queue = CommandQueue()
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val running = Answers()
        val queued = Answers()
        var queuedRan = false
        queue.run(running::take) {
            started.countDown()
            release.await(5, TimeUnit.SECONDS)
            mapOf("ok" to true)
        }
        assertTrue(started.await(5, TimeUnit.SECONDS), "the first command started")
        queue.run(queued::take) {
            queuedRan = true
            mapOf("ok" to true)
        }
        queue.close()
        release.countDown()
        assertEquals(mapOf("ok" to true), running.await())
        assertEquals(unknown, queued.await())
        assertEquals(false, queuedRan, "a queued command does not run after close")
        Thread.sleep(50)
        assertEquals(1, queued.values.size, "it answered once")
    }
}
