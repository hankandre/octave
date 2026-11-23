package dev.octave.artwork.load

import dev.octave.session.http.ArtworkAnswer
import dev.octave.session.http.ArtworkRequest
import dev.octave.session.http.PreparedArtwork
import dev.octave.session.http.SessionId
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

// T3-11 review fix: an ended session's cached images leave the cache at the next load for any session, and a fetch
// that finishes after its session ended is neither returned nor cached.
class ArtworkLoaderEndedSessionTest {
    private val sessionA = SessionId.parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")!!
    private val sessionB = SessionId.parse("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")!!
    private val tag = "5f3e2d1c0b9a87654321fedcba987654"
    private val held: MutableSet<SessionId> = ConcurrentHashMap.newKeySet<SessionId>().apply { add(sessionA); add(sessionB) }
    private val requests = CopyOnWriteArrayList<ArtworkRequest>()

    @Volatile private var gate: CountDownLatch? = null
    @Volatile private var started: CountDownLatch? = null

    private fun prepare(session: SessionId, request: ArtworkRequest): PreparedArtwork {
        requests += request
        return object : PreparedArtwork {
            override fun execute(timeoutMs: Long): ArtworkAnswer {
                started?.countDown()
                gate?.await(5, TimeUnit.SECONDS)
                return ArtworkAnswer.Bytes(byteArrayOf(1))
            }

            override fun cancel() = Unit
        }
    }

    private val decoder = object : ArtworkDecoder {
        override fun decode(bytes: ByteArray, width: Int): Decoded = Decoded(Any(), 10)
    }

    private fun loader(cacheBytes: Long) =
        ArtworkLoader(source = ::prepare, decoder = decoder, holds = { held.contains(it) }, cacheBytes = cacheBytes)

    private fun key(session: SessionId, item: String) = ArtworkKey.of(session, item, "Primary", tag, 248.0)!!

    @Test
    fun a_load_for_another_session_drops_an_ended_sessions_entries_before_they_can_evict_a_live_one() = runBlocking {
        val loader = loader(cacheBytes = 20L) // room for two images
        assertTrue(loader.load(key(sessionB, "b1")) is ArtworkLoader.Result.Loaded)
        assertTrue(loader.load(key(sessionA, "a1")) is ArtworkLoader.Result.Loaded) // b1 is now the eldest
        held.remove(sessionA)

        assertTrue(loader.load(key(sessionB, "b2")) is ArtworkLoader.Result.Loaded)
        val before = requests.size
        assertTrue(loader.load(key(sessionB, "b1")) is ArtworkLoader.Result.Loaded)
        assertEquals(before, requests.size, "b1 stays cached: the ended session's a1 left first, not the live b1")
    }

    @Test
    fun a_fetch_that_finishes_after_its_session_ended_is_failed_and_not_cached() = runBlocking {
        val loader = loader(cacheBytes = 1_000L)
        gate = CountDownLatch(1)
        started = CountDownLatch(1)
        val pending = async(kotlinx.coroutines.Dispatchers.Default) { loader.load(key(sessionA, "a1")) }
        assertTrue(started!!.await(5, TimeUnit.SECONDS))
        held.remove(sessionA)
        gate!!.countDown()
        assertEquals(ArtworkLoader.Result.Failed, pending.await())

        gate = null
        started = null
        held.add(sessionA)
        val before = requests.size
        assertTrue(loader.load(key(sessionA, "a1")) is ArtworkLoader.Result.Loaded)
        assertEquals(before + 1, requests.size, "the late result was not cached, so the image is fetched again")
    }
}
