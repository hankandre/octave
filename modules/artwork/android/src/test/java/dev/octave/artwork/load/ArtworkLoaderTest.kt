package dev.octave.artwork.load

import dev.octave.session.http.ArtworkAnswer
import dev.octave.session.http.ArtworkRequest
import dev.octave.session.http.PreparedArtwork
import dev.octave.session.http.SessionId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

// T3-11 acceptance items 3, 4 and 5, the loader half (docs/specs/T3-11.md, "The loader"; spec check issues 1, 2, 3
// and 9). Plain Kotlin with a fake source and a fake decoder: the real fetch needs a registry session only the session
// module's tests can open, so it is held there (ArtworkFetchTest) and on the device (artwork-header-and-cache).
//
// The contract frozen here (package dev.octave.artwork.load, no Android import):
// - ArtworkKey.of(session: SessionId, itemId: String, type: String, tag: String, width: Double): ArtworkKey? is the
//   view's prop conversion. It rounds the drawn width to the nearest Int and caps it with the session module's
//   ArtworkRequest.cappedWidth, so a Primary drawn 600 wide and one drawn 400 wide are one key. It answers null for a
//   width that is NaN or infinite or rounds below 1, and for a type cappedWidth refuses. Keys are equal by session,
//   item id, type, tag and capped width (its `width: Int`). toString() holds no session id, item id or tag.
// - class Decoded(image: Any, byteCount: Int); interface ArtworkDecoder { fun decode(bytes: ByteArray, width: Int):
//   Decoded? }.
// - ArtworkLoader(source: (SessionId, ArtworkRequest) -> PreparedArtwork?, decoder: ArtworkDecoder,
//   holds: (SessionId) -> Boolean, cacheBytes: Long, parallelism: Int = 4).
// - suspend fun load(key): ArtworkLoader.Result, sealed: Loaded(image: Any) or Failed.
//   - A hit is served while holds(key.session); it fetches nothing.
//   - A hit for a session holds answers false for is not served and fetches nothing: the answer is Failed, and every
//     cached entry of that session is dropped.
//   - A miss asks the source for an ArtworkRequest(itemId, type, tag, key.width), executes it with a 15 000 ms timeout
//     off the calling thread, decodes the bytes at key.width, caches a success and returns Loaded.
//   - A refused request (source null), a Failed answer, an undecodable body (decoder null) and a source or decoder
//     that throws are each Failed, and a failure is not cached.
//   - The cache is an LRU in access order bounded by the sum of byteCount; an image larger than the budget is returned
//     but not kept.
//   - At most `parallelism` executions run at once.
//   - Cancelling the coroutine of a load calls PreparedArtwork.cancel(), and the cancelled load is not cached.
class ArtworkLoaderTest {
    private val sessionA = SessionId.parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")!!
    private val sessionB = SessionId.parse("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")!!
    private val item = "a1b2c3d4e5f60718293a4b5c6d7e8f90"
    private val tag = "5f3e2d1c0b9a87654321fedcba987654"

    private class FakeSource {
        val requests = CopyOnWriteArrayList<Pair<SessionId, ArtworkRequest>>()
        val timeouts = CopyOnWriteArrayList<Long>()
        val threads = CopyOnWriteArrayList<Thread>()
        @Volatile var refuse = false
        @Volatile var answer: () -> ArtworkAnswer = { ArtworkAnswer.Bytes(byteArrayOf(1, 2, 3)) }

        fun prepare(session: SessionId, request: ArtworkRequest): PreparedArtwork? {
            requests += session to request
            if (refuse) return null
            return object : PreparedArtwork {
                override fun execute(timeoutMs: Long): ArtworkAnswer {
                    timeouts += timeoutMs
                    threads += Thread.currentThread()
                    return answer()
                }

                override fun cancel() = Unit
            }
        }

        val fetches: Int get() = requests.size
    }

    private class FakeDecoder(@Volatile var byteCount: Int = 10) : ArtworkDecoder {
        val widths = CopyOnWriteArrayList<Int>()
        private val made = AtomicInteger()
        @Volatile var undecodable = false
        @Volatile var throws = false

        override fun decode(bytes: ByteArray, width: Int): Decoded? {
            widths += width
            if (throws) throw IllegalStateException("decoder failure")
            if (undecodable) return null
            return Decoded("image-${made.incrementAndGet()}", byteCount)
        }
    }

    private val held: MutableSet<SessionId> = ConcurrentHashMap.newKeySet<SessionId>().apply { add(sessionA); add(sessionB) }

    private fun loader(source: FakeSource, decoder: ArtworkDecoder = FakeDecoder(), cacheBytes: Long = 1_000L, parallelism: Int = 4) =
        ArtworkLoader(source = source::prepare, decoder = decoder, holds = { held.contains(it) }, cacheBytes = cacheBytes, parallelism = parallelism)

    private fun key(session: SessionId = sessionA, itemId: String = item, type: String = "Primary", tag: String = this.tag, width: Double = 248.0): ArtworkKey =
        checkNotNull(ArtworkKey.of(session, itemId, type, tag, width)) { "the key was refused" }

    private fun imageOf(result: ArtworkLoader.Result): Any {
        assertTrue(result is ArtworkLoader.Result.Loaded, "Loaded, not $result")
        return (result as ArtworkLoader.Result.Loaded).image
    }

    // ---- the key: item 3's width rule where the view converts its prop ----

    @Test
    fun the_key_rounds_the_drawn_width_and_caps_it_with_the_shared_cap() {
        assertEquals(248, key(width = 248.0).width)
        assertEquals(248, key(width = 247.6).width)
        assertEquals(248, key(width = 248.4).width)
        assertEquals(400, key(width = 600.0).width, "a Primary is capped at 400")
        assertEquals(key(width = 400.0), key(width = 600.0), "600 and 400 for a Primary are one key")
        assertEquals(416, key(type = "Thumb", width = 416.0).width)
        assertEquals(1920, key(type = "Thumb", width = 4000.0).width, "a Thumb is capped at 1920")
        assertEquals(ArtworkRequest.cappedWidth("Primary", 600), key(width = 600.0).width, "the cap is the session module's")
    }

    @Test
    fun the_key_refuses_a_width_that_is_not_finite_or_rounds_below_1_and_a_type_outside_the_four() {
        for (width in listOf(0.0, 0.4, -1.0, -248.0, Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY)) {
            assertNull(ArtworkKey.of(sessionA, item, "Primary", tag, width), "width $width")
        }
        assertNotNull(ArtworkKey.of(sessionA, item, "Primary", tag, 0.6), "0.6 rounds to 1")
        for (type in listOf("Chapter", "primary", "")) assertNull(ArtworkKey.of(sessionA, item, type, tag, 248.0), "type '$type'")
    }

    @Test
    fun keys_differ_by_session_item_type_tag_and_capped_width() {
        val base = key()
        assertEquals(base, key())
        assertEquals(base.hashCode(), key().hashCode())
        for (other in listOf(key(session = sessionB), key(itemId = "other-item"), key(type = "Thumb"), key(tag = "other-tag"), key(width = 300.0))) {
            assertNotEquals(base, other)
        }
    }

    @Test
    fun a_key_prints_no_session_id_item_id_or_tag() {
        val text = key().toString()
        for (secret in listOf(sessionA.value, item, tag)) assertFalse(text.contains(secret), "the key's toString holds a value it must not print")
    }

    // ---- item 4: the cache ----

    @Test
    fun the_same_key_twice_fetches_once() = runBlocking {
        val source = FakeSource()
        val loader = loader(source)
        val first = imageOf(loader.load(key()))
        val second = imageOf(loader.load(key()))
        assertSame(first, second, "the second load is the cached image")
        assertEquals(1, source.fetches)
    }

    @Test
    fun a_primary_drawn_600_and_400_wide_share_one_entry_and_the_request_is_capped() = runBlocking {
        val source = FakeSource()
        val decoder = FakeDecoder()
        val loader = loader(source, decoder)
        imageOf(loader.load(key(width = 600.0)))
        imageOf(loader.load(key(width = 400.0)))
        assertEquals(1, source.fetches)
        val (session, request) = source.requests.single()
        assertEquals(sessionA, session)
        assertEquals(item, request.itemId)
        assertEquals("Primary", request.type)
        assertEquals(tag, request.tag)
        assertEquals(400, request.width, "the request asks for the capped width")
        assertEquals(listOf(400), decoder.widths.toList(), "the decoder samples to the capped width")
    }

    @Test
    fun another_tag_type_width_item_or_session_fetches_again() = runBlocking {
        val source = FakeSource()
        val loader = loader(source)
        imageOf(loader.load(key()))
        val others = listOf(key(tag = "other-tag"), key(type = "Thumb"), key(width = 300.0), key(itemId = "other-item"), key(session = sessionB))
        for (other in others) imageOf(loader.load(other))
        assertEquals(1 + others.size, source.fetches)
    }

    @Test
    fun a_hit_after_the_session_ended_is_not_served_fetches_nothing_and_drops_that_sessions_entries() = runBlocking {
        val source = FakeSource()
        val loader = loader(source)
        imageOf(loader.load(key()))
        imageOf(loader.load(key(tag = "second-tag")))
        imageOf(loader.load(key(session = sessionB)))
        assertEquals(3, source.fetches)
        held.remove(sessionA)
        val ended = loader.load(key())
        assertTrue(ended is ArtworkLoader.Result.Failed, "a hit for an ended session is Failed")
        assertEquals(3, source.fetches, "nothing is fetched for an ended session's hit")
        // The registry never hands an id out twice; the fake does, to show the entries are gone rather than hidden.
        held.add(sessionA)
        imageOf(loader.load(key()))
        imageOf(loader.load(key(tag = "second-tag")))
        assertEquals(5, source.fetches, "both of the ended session's entries were dropped")
        imageOf(loader.load(key(session = sessionB)))
        assertEquals(5, source.fetches, "another session's entry is kept")
    }

    @Test
    fun eviction_is_by_byte_size_in_access_order() = runBlocking {
        val source = FakeSource()
        val loader = loader(source, FakeDecoder(byteCount = 40), cacheBytes = 100L)
        val one = key(itemId = "item-1")
        val two = key(itemId = "item-2")
        val three = key(itemId = "item-3")
        imageOf(loader.load(one))
        imageOf(loader.load(two))
        imageOf(loader.load(one))
        assertEquals(2, source.fetches, "two entries of 40 fit in 100")
        imageOf(loader.load(three))
        assertEquals(3, source.fetches)
        imageOf(loader.load(one))
        assertEquals(3, source.fetches, "the entry used last is kept")
        imageOf(loader.load(two))
        assertEquals(4, source.fetches, "the entry used least recently was evicted")
    }

    @Test
    fun an_image_larger_than_the_budget_is_returned_but_not_kept() = runBlocking {
        val source = FakeSource()
        val loader = loader(source, FakeDecoder(byteCount = 150), cacheBytes = 100L)
        imageOf(loader.load(key()))
        imageOf(loader.load(key()))
        assertEquals(2, source.fetches)
    }

    // ---- items 3 and 5: the fetch behind the cache, and every failure ----

    @Test
    fun a_miss_executes_with_a_15_second_timeout_off_the_calling_thread() = runBlocking {
        val source = FakeSource()
        val loader = loader(source)
        val caller = Thread.currentThread()
        imageOf(loader.load(key()))
        assertEquals(listOf(15_000L), source.timeouts.toList())
        assertTrue(source.threads.none { it === caller }, "execute runs off the calling thread")
    }

    @Test
    fun each_failure_class_is_failed_and_is_not_cached() = runBlocking {
        val cases: List<Pair<String, (FakeSource, FakeDecoder) -> Unit>> = listOf(
            "a refused request" to { source, _ -> source.refuse = true },
            "a Failed answer" to { source, _ -> source.answer = { ArtworkAnswer.Failed } },
            "an execute that throws" to { source, _ -> source.answer = { throw IllegalStateException("execute failure") } },
            "an undecodable body" to { _, decoder -> decoder.undecodable = true },
            "a decoder that throws" to { _, decoder -> decoder.throws = true },
        )
        for ((name, breakIt) in cases) {
            val source = FakeSource()
            val decoder = FakeDecoder()
            val loader = loader(source, decoder)
            breakIt(source, decoder)
            val first = loader.load(key())
            assertTrue(first is ArtworkLoader.Result.Failed, "$name is Failed")
            val second = loader.load(key())
            assertTrue(second is ArtworkLoader.Result.Failed, "$name is Failed again")
            assertEquals(2, source.fetches, "$name: a failure is not cached, so the second load fetches again")
            source.refuse = false
            source.answer = { ArtworkAnswer.Bytes(byteArrayOf(1, 2, 3)) }
            decoder.undecodable = false
            decoder.throws = false
            imageOf(loader.load(key()))
            assertEquals(3, source.fetches, "$name: once the cause is gone the image loads")
        }
    }

    @Test
    fun at_most_four_executions_run_at_once() = runBlocking {
        val active = AtomicInteger()
        val most = AtomicInteger()
        val release = CountDownLatch(1)
        val source = FakeSource()
        source.answer = {
            most.accumulateAndGet(active.incrementAndGet()) { a, b -> maxOf(a, b) }
            try {
                release.await(10, TimeUnit.SECONDS)
                ArtworkAnswer.Bytes(byteArrayOf(1))
            } finally {
                active.decrementAndGet()
            }
        }
        val loader = loader(source)
        val loads = (1..6).map { index -> async(Dispatchers.Default) { loader.load(key(itemId = "item-$index")) } }
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        while (active.get() < 4 && System.nanoTime() < deadline) delay(10)
        delay(200)
        assertEquals(4, active.get(), "four executions run while the others wait")
        release.countDown()
        withTimeout(10_000) { loads.awaitAll() }.forEach { imageOf(it) }
        assertEquals(4, most.get(), "never more than four at once")
    }

    @Test
    fun cancelling_a_load_cancels_its_request_and_caches_nothing() = runBlocking {
        val started = CountDownLatch(1)
        val cancelled = CountDownLatch(1)
        val requests = AtomicInteger()
        val source: (SessionId, ArtworkRequest) -> PreparedArtwork? = { _, _ ->
            requests.incrementAndGet()
            object : PreparedArtwork {
                override fun execute(timeoutMs: Long): ArtworkAnswer {
                    if (requests.get() > 1) return ArtworkAnswer.Bytes(byteArrayOf(1))
                    started.countDown()
                    cancelled.await(10, TimeUnit.SECONDS)
                    return ArtworkAnswer.Failed
                }

                override fun cancel() = cancelled.countDown()
            }
        }
        val loader = ArtworkLoader(source = source, decoder = FakeDecoder(), holds = { held.contains(it) }, cacheBytes = 1_000L)
        val job = launch(Dispatchers.Default) { loader.load(key()) }
        assertTrue(started.await(5, TimeUnit.SECONDS), "the request started")
        job.cancel()
        assertTrue(cancelled.await(5, TimeUnit.SECONDS), "cancelling the load called PreparedArtwork.cancel()")
        withTimeout(10_000) { job.join() }
        imageOf(loader.load(key()))
        assertEquals(2, requests.get(), "the cancelled load was not cached")
    }
}
