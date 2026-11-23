package dev.octave.session.http

import okhttp3.Call
import okhttp3.Request
import java.util.concurrent.TimeUnit

// The image request of the native artwork view (T3-11; docs/specs/T3-11.md, "The fetch"; decision 0005, amendment
// T3-11). Kotlin only: no JavaScript surface. It builds GET {base}/Items/{itemId}/Images/{type} against the registry
// entry's address and sends it through the one client with CallAuthority.Session, so SessionInterceptor adds the
// header and runs every policy. Nothing but bytes or Failed leaves: no exception, status, URL or header. A 401 does
// not end the session here (T4-05's rule).

// One image by item, type, tag and drawn width in canvas px.
class ArtworkRequest(val itemId: String, val type: String, val tag: String, val width: Int) {
    override fun toString(): String = "ArtworkRequest([redacted])"

    companion object {
        private val CAPS = mapOf("Primary" to 400, "Backdrop" to 1920, "Thumb" to 1920, "Logo" to 1920)

        // The one cap (spec check issues 2 and 3): null for a type outside the four or a width below 1; otherwise the
        // width capped at 400 for Primary and 1920 for the others. The artwork module's cache key uses it too, so the
        // key and maxWidth never disagree. Held by packages/core/tests/fixtures/image-requests.json.
        fun cappedWidth(type: String, width: Int): Int? {
            val cap = CAPS[type] ?: return null
            if (width < 1) return null
            return minOf(width, cap)
        }
    }
}

sealed class ArtworkAnswer {
    class Bytes(val bytes: ByteArray) : ArtworkAnswer() {
        override fun toString(): String = "ArtworkAnswer.Bytes([redacted])"
    }

    object Failed : ArtworkAnswer() {
        override fun toString(): String = "ArtworkAnswer.Failed"
    }
}

// A prepared image request. execute sends it once; cancel ends it from any thread. Public so another module's tests can
// fake it; the one implementation is internal.
interface PreparedArtwork {
    fun execute(timeoutMs: Long): ArtworkAnswer

    fun cancel()
}

object ArtworkFetch {
    private val UNRESERVED = Regex("^[A-Za-z0-9._~-]+$")
    private const val MAX_ITEM_ID = 64
    private const val MAX_TAG = 128

    // Null, with nothing sent, for a session the registry does not hold or a request the grammar refuses.
    fun prepare(session: SessionId, request: ArtworkRequest): PreparedArtwork? {
        val width = ArtworkRequest.cappedWidth(request.type, request.width) ?: return null
        if (!unreserved(request.itemId, MAX_ITEM_ID) || !unreserved(request.tag, MAX_TAG)) return null
        val path = "/Items/${request.itemId}/Images/${request.type}"
        if (!RequestPath.isSafe(path)) return null
        val entry = SessionRegistry.entry(session) ?: return null
        val query = QueryEncoding.encode(listOf("tag" to request.tag, "maxWidth" to width.toString(), "quality" to "90", "format" to "Webp"))
        val built = try {
            Request.Builder().url(entry.address.url(path, query)).header("Accept", "image/*").get().build()
        } catch (_: IllegalArgumentException) {
            return null
        }
        return SessionArtwork(OctaveHttp.newCall(built, CallAuthority.Session(session)))
    }

    private fun unreserved(text: String, max: Int): Boolean = text.length in 1..max && UNRESERVED.matches(text)
}

// One call through the one client. No resend: OkHttp's retryOnConnectionFailure is off (OctaveHttp).
internal class SessionArtwork(private val call: Call) : PreparedArtwork {
    override fun execute(timeoutMs: Long): ArtworkAnswer = try {
        call.timeout().timeout(timeoutMs, TimeUnit.MILLISECONDS)
        call.execute().use { response ->
            if (response.code !in 200..299) return@use ArtworkAnswer.Failed
            val body = response.body
            val cap = ResponseCaps.SESSION_READ
            if (body.contentLength() > cap) return@use ArtworkAnswer.Failed
            val source = body.source()
            if (source.request(cap + 1)) return@use ArtworkAnswer.Failed
            ArtworkAnswer.Bytes(source.buffer.readByteArray())
        }
    } catch (_: Throwable) {
        ArtworkAnswer.Failed
    }

    override fun cancel() = call.cancel()

    override fun toString(): String = "PreparedArtwork([redacted])"
}
