package dev.octave.artwork.load

import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNotSame
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

// T3-39 acceptance items 1, 4 and 7 (docs/specs/T3-39.md, "The preview loader" and "Decode cost and recycled cards"):
// the preview is decoded off the calling thread on an injected dispatcher, at most once per hash while it stays cached,
// and a cached preview is served synchronously, so a recycled card draws it at mount with no decode. A refused hash
// caches nothing. The decode is a counting fake here; BlurHashTest holds the real decoder's 32 x 32 output.
//
// The contract frozen here (package dev.octave.artwork.load, plain Kotlin, no Android import):
// - class PreviewLoader(decode: (String) -> Decoded?, budgetBytes: Long, work: CoroutineDispatcher), in that order.
//   It takes no fetch, request or session.
// - fun cached(hash: String): Decoded? answers the cached preview for the hash, or null, without suspending.
// - suspend fun load(hash: String): Decoded? answers the cached preview, or runs decode(hash) on `work`, caches a
//   non-null result by the hash string alone and answers it; a null result (a refused hash) is answered and not cached.
// - The cache is least recently used, bounded by the sum of Decoded.byteCount within budgetBytes; an evicted preview is
//   dropped, never recycled.
// - Cancelling the coroutine of a load caches nothing.
class PreviewLoaderTest {
    private val executor = Executors.newSingleThreadExecutor { runnable -> Thread(runnable, WORK_THREAD) }
    private val work = executor.asCoroutineDispatcher()

    private class CountingDecode(private val refuse: Set<String> = emptySet(), private val bytes: Int = PREVIEW_BYTES) {
        val calls = CopyOnWriteArrayList<String>()
        val threads = CopyOnWriteArrayList<String>()
        val made = ConcurrentHashMap<String, MutableList<Decoded>>()

        fun decode(hash: String): Decoded? {
            calls += hash
            threads += Thread.currentThread().name
            if (hash in refuse) return null
            return Decoded(IntArray(1024), bytes).also { made.getOrPut(hash) { CopyOnWriteArrayList() } += it }
        }

        fun count(hash: String): Int = calls.count { it == hash }
    }

    @AfterEach
    fun stop() {
        work.close()
    }

    // Not a suspend function, so cached() must not be one either.
    private fun servedAtMount(previews: PreviewLoader, hash: String): Decoded? = previews.cached(hash)

    private fun loader(decode: CountingDecode, budget: Long = MIB): PreviewLoader = PreviewLoader(decode::decode, budget, work)

    @Test
    fun the_decode_runs_on_the_injected_dispatcher_not_the_callers_thread() = runBlocking {
        val decode = CountingDecode()
        val previews = loader(decode)
        val caller = Thread.currentThread().name
        val result = withTimeout(5_000) { previews.load(HASH_A) }
        assertNotNull(result)
        assertEquals(listOf(WORK_THREAD), decode.threads.toList(), "the decode ran on the injected dispatcher's thread")
        assertTrue(caller != WORK_THREAD, "the test calls from a different thread")
    }

    @Test
    fun a_loaded_preview_is_the_decodes_own_result() = runBlocking {
        val decode = CountingDecode()
        val previews = loader(decode)
        val result = withTimeout(5_000) { previews.load(HASH_A) }
        assertSame(decode.made.getValue(HASH_A).single(), result)
    }

    @Test
    fun the_same_hash_twice_decodes_once_and_the_cache_serves_the_same_preview() = runBlocking {
        val decode = CountingDecode()
        val previews = loader(decode)
        assertNull(previews.cached(HASH_A), "nothing is cached before a load")
        val first = withTimeout(5_000) { previews.load(HASH_A) }
        val second = withTimeout(5_000) { previews.load(HASH_A) }
        assertEquals(1, decode.count(HASH_A), "one decode for two loads")
        assertNotNull(first)
        assertSame(first, second, "the second load answers the cached preview")
        assertSame(first, previews.cached(HASH_A), "cached() answers the same preview")
    }

    @Test
    fun a_cached_preview_is_served_synchronously_on_the_callers_thread_with_no_decode() = runBlocking {
        val decode = CountingDecode()
        val previews = loader(decode)
        val loaded = withTimeout(5_000) { previews.load(HASH_A) }
        // The view's propsUpdated() calls cached() on the main thread: a plain call, not a suspend function.
        val served = servedAtMount(previews, HASH_A)
        assertSame(loaded, served)
        assertEquals(1, decode.calls.size, "cached() decodes nothing")
        assertNull(previews.cached(HASH_B), "a hash never loaded is not cached")
        assertEquals(1, decode.calls.size, "a miss in cached() decodes nothing either")
    }

    @Test
    fun the_cache_is_keyed_by_the_hash_string() = runBlocking {
        val decode = CountingDecode()
        val previews = loader(decode)
        val a = withTimeout(5_000) { previews.load(HASH_A) }
        val b = withTimeout(5_000) { previews.load(HASH_B) }
        assertNotSame(a, b)
        assertSame(a, previews.cached(String(HASH_A.toCharArray())), "an equal string, not the same instance, finds it")
        assertSame(b, previews.cached(HASH_B))
        assertEquals(listOf(HASH_A, HASH_B), decode.calls.toList())
    }

    @Test
    fun a_refused_hash_gives_null_caches_nothing_and_is_decoded_again() = runBlocking {
        val decode = CountingDecode(refuse = setOf(REFUSED))
        val previews = loader(decode)
        assertNull(withTimeout(5_000) { previews.load(REFUSED) })
        assertNull(previews.cached(REFUSED), "a refusal is not cached")
        assertNull(withTimeout(5_000) { previews.load(REFUSED) })
        assertEquals(2, decode.count(REFUSED), "the next load decodes again")
    }

    @Test
    fun a_budget_of_three_previews_evicts_the_least_recently_used() = runBlocking {
        val decode = CountingDecode()
        val previews = loader(decode, budget = 3L * PREVIEW_BYTES)
        for (hash in listOf(HASH_A, HASH_B, HASH_C)) withTimeout(5_000) { previews.load(hash) }
        assertNotNull(previews.cached(HASH_A), "touch A, so B is now the least recently used")
        withTimeout(5_000) { previews.load(HASH_D) }
        assertNull(previews.cached(HASH_B), "B was evicted")
        for (hash in listOf(HASH_A, HASH_C, HASH_D)) assertNotNull(previews.cached(hash), "$hash is kept")
        withTimeout(5_000) { previews.load(HASH_B) }
        assertEquals(2, decode.count(HASH_B), "an evicted hash is decoded again")
    }

    @Test
    fun one_mib_holds_256_previews_and_the_257th_evicts_the_oldest() = runBlocking {
        val decode = CountingDecode()
        val previews = loader(decode, budget = MIB)
        val hashes = (0 until 257).map { "hash-$it" }
        for (hash in hashes.take(256)) withTimeout(5_000) { previews.load(hash) }
        assertTrue(hashes.take(256).all { previews.cached(it) != null }, "256 previews of 4 096 bytes fit in 1 MiB")
        withTimeout(5_000) { previews.load(hashes[256]) }
        assertNull(previews.cached(hashes[0]), "the oldest is evicted")
        assertTrue(hashes.drop(1).all { previews.cached(it) != null }, "the other 256 are kept")
        assertEquals(257, decode.calls.size, "one decode per distinct hash")
    }

    @Test
    fun a_preview_larger_than_the_budget_is_answered_but_not_kept() = runBlocking {
        val decode = CountingDecode(bytes = PREVIEW_BYTES * 2)
        val previews = loader(decode, budget = PREVIEW_BYTES.toLong())
        assertNotNull(withTimeout(5_000) { previews.load(HASH_A) })
        assertNull(previews.cached(HASH_A))
    }

    @Test
    fun cancelling_a_load_caches_nothing() = runBlocking {
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val calls = AtomicInteger()
        val previews = PreviewLoader(
            { _: String ->
                calls.incrementAndGet()
                started.countDown()
                release.await(5, TimeUnit.SECONDS)
                Decoded(IntArray(1024), PREVIEW_BYTES)
            },
            MIB,
            work,
        )
        val job = launch(start = CoroutineStart.UNDISPATCHED) { previews.load(HASH_A) }
        assertTrue(started.await(5, TimeUnit.SECONDS), "the decode started")
        job.cancel()
        release.countDown()
        withTimeout(5_000) { job.join() }
        assertTrue(job.isCancelled, "the load was cancelled")
        assertNull(previews.cached(HASH_A), "a cancelled load caches nothing")
        assertNotNull(withTimeout(5_000) { previews.load(HASH_A) })
        assertEquals(2, calls.get(), "the next load decodes again")
    }

    companion object {
        private const val WORK_THREAD = "preview-loader-test-work"
        private const val PREVIEW_BYTES = 32 * 32 * 4
        private const val MIB = 1024L * 1024
        private const val HASH_A = "LEHV6nWB2yk8pyo0adR*.7kCMdnj"
        private const val HASH_B = "diE|rGDNI9tmPpMca0tSO@xFs9R%xuofWARiNGkWWVso"
        private const val HASH_C = "005?}k"
        private const val HASH_D = "00TSUA"
        private const val REFUSED = "00TSUB"
    }
}
