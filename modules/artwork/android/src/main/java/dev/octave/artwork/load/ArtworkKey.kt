package dev.octave.artwork.load

import dev.octave.session.http.ArtworkRequest
import dev.octave.session.http.SessionId

// One image as the view asks for it and the cache keeps it (T3-11): the session, the item, the type, the tag and the
// width after the session module's one cap. Equal keys are one cache entry, so a Primary drawn 600 and 400 wide share
// one. Its debug form names nothing.
class ArtworkKey private constructor(
    val session: SessionId,
    val itemId: String,
    val type: String,
    val tag: String,
    val width: Int,
) {
    fun request(): ArtworkRequest = ArtworkRequest(itemId, type, tag, width)

    override fun equals(other: Any?): Boolean =
        other is ArtworkKey && other.session == session && other.itemId == itemId && other.type == type && other.tag == tag && other.width == width

    override fun hashCode(): Int = listOf(session, itemId, type, tag, width).hashCode()

    override fun toString(): String = "ArtworkKey([redacted])"

    companion object {
        // The view's prop conversion (spec check issue 2): the drawn width in canvas px, rounded to a whole number and
        // capped by ArtworkRequest.cappedWidth. Null for a NaN or infinite width, one that rounds below 1, or a type
        // the cap refuses.
        fun of(session: SessionId, itemId: String, type: String, tag: String, width: Double): ArtworkKey? {
            if (!width.isFinite()) return null
            val rounded = Math.round(width)
            if (rounded < 1 || rounded > Int.MAX_VALUE) return null
            val capped = ArtworkRequest.cappedWidth(type, rounded.toInt()) ?: return null
            return ArtworkKey(session, itemId, type, tag, capped)
        }
    }
}
