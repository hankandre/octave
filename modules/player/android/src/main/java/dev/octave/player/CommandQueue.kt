package dev.octave.player

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExecutorCoroutineDispatcher
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

// The player module's own single thread: commands run one at a time in the order they came, off Expo's shared modules
// queue. Every command answers exactly once: with its result, with `unknown` when it throws, and with `unknown` when
// the queue closed before it ran (a module torn down during a JS reload), so a JavaScript await never hangs.
internal class CommandQueue {
    private val dispatcher: ExecutorCoroutineDispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    private val scope = CoroutineScope(SupervisorJob() + dispatcher)

    fun run(answer: (Map<String, Any?>) -> Unit, call: () -> Map<String, Any?>) {
        val answered = AtomicBoolean(false)
        val once = { result: Map<String, Any?> -> if (answered.compareAndSet(false, true)) answer(result) }
        val job = scope.launch {
            // PlayerSeam catches everything itself; this is the last guard, and it carries a code only.
            val result = try {
                call()
            } catch (_: Throwable) {
                UNKNOWN
            }
            once(result)
        }
        job.invokeOnCompletion { once(UNKNOWN) }
    }

    fun close() {
        scope.cancel()
        dispatcher.close()
    }

    private companion object {
        val UNKNOWN: Map<String, Any?> = mapOf("error" to "unknown")
    }
}
