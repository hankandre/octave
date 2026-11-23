package dev.octave.player.seam

import dev.octave.session.http.SessionId
import java.net.URI
import java.net.URISyntaxException
import java.net.URLDecoder

// Reads the launch argument map by hand against the key table of docs/specs/T8-01.md ("The launch request") and
// answers the typed request, or null for any other shape (rules U0 to U3). It never throws.
//
// Limits: at most 256 tracks and URLs of at most 8192 characters (refused above), a start of 0 or more (refused
// below), and other strings cut to 512 characters, so a long title never turns a playable file into a refusal.
object LaunchRequestReader {
    private const val MAX_TRACKS = 256
    private const val MAX_STRING = 512
    private const val MAX_URL = 8192

    private val COMMON_KEYS = setOf("kind", "sessionId", "startPositionSeconds", "tracks", "audioStreamIndex", "subtitleStreamIndex")
    private val ORIGINAL_KEYS = COMMON_KEYS + "url"
    private val HLS_KEYS = COMMON_KEYS + setOf("masterUrl", "serverUrl", "mediaKind")
    private val TRACK_KEYS = setOf(
        "index", "type", "displayTitle", "external", "codec", "language", "deliveryUrl", "title", "channels", "isDefault",
        "isForced", "isHearingImpaired",
    )
    private val TRACK_TYPES = setOf("Audio", "Subtitle", "Video")

    // S1 of the core (packages/core/src/player/launch-request.ts): `/Videos/{id}/stream` under any prefix.
    private val ORIGINAL_PATH = Regex("^(?:/[^/]+)*/Videos/[^/]+/stream$")

    // Characters a WHATWG href may keep after the authority that java.net.URI refuses. They are escaped only to parse;
    // the request keeps the text as the core sent it.
    private const val PARSE_ESCAPES = "|^{}[]\\`"

    fun read(args: Map<String, Any?>): LaunchRequest? = try {
        readOrNull(args)
    } catch (_: Exception) {
        null
    }

    private fun readOrNull(args: Map<String, Any?>): LaunchRequest? {
        val kind = args["kind"] as? String ?: return null
        val allowed = when (kind) {
            "original" -> ORIGINAL_KEYS
            "hls" -> HLS_KEYS
            else -> return null
        }
        if (!allowed.containsAll(args.keys)) return null
        val session = (args["sessionId"] as? String)?.let { SessionId.parse(it) } ?: return null
        val start = finite(args["startPositionSeconds"]) ?: return null
        if (start < 0.0) return null
        val audioIndex = optionalInt(args, "audioStreamIndex", min = 0) ?: return null
        val subtitleIndex = optionalInt(args, "subtitleStreamIndex", min = -1) ?: return null
        val rawTracks = args["tracks"] as? List<*> ?: return null
        if (rawTracks.size > MAX_TRACKS) return null
        val tracks = rawTracks.map { track(it) ?: return null }
        val trackUrls = tracks.mapNotNull { it.deliveryUrl }

        return when (kind) {
            "original" -> {
                val url = args["url"] as? String ?: return null
                val parsed = parse(url) ?: return null
                if (!isOriginalShape(parsed)) return null
                if (!sameOrigin(listOf(url) + trackUrls)) return null
                LaunchRequest.Original(session, start, tracks, audioIndex.value, subtitleIndex.value, url)
            }
            else -> {
                val masterUrl = args["masterUrl"] as? String ?: return null
                val serverUrl = args["serverUrl"] as? String ?: return null
                val mediaKind = when (args["mediaKind"]) {
                    "videos" -> MediaKind.VIDEOS
                    "audio" -> MediaKind.AUDIO
                    else -> return null
                }
                if (!sameOrigin(listOf(masterUrl, serverUrl) + trackUrls)) return null
                LaunchRequest.Hls(session, start, tracks, audioIndex.value, subtitleIndex.value, masterUrl, serverUrl, mediaKind)
            }
        }
    }

    private fun track(value: Any?): MediaTrack? {
        val map = value as? Map<*, *> ?: return null
        if (!map.keys.all { it is String && it in TRACK_KEYS }) return null
        val index = integer(map["index"]) ?: return null
        if (index < 0) return null
        val type = map["type"] as? String ?: return null
        if (type !in TRACK_TYPES) return null
        val displayTitle = map["displayTitle"] as? String ?: return null
        val external = map["external"] as? Boolean ?: return null
        val codec = optionalString(map, "codec") ?: return null
        val language = optionalString(map, "language") ?: return null
        val title = optionalString(map, "title") ?: return null
        val channels = optionalInt(map, "channels", min = 0) ?: return null
        val isDefault = optionalBoolean(map, "isDefault") ?: return null
        val isForced = optionalBoolean(map, "isForced") ?: return null
        val isHearingImpaired = optionalBoolean(map, "isHearingImpaired") ?: return null
        val deliveryUrl = if (map.containsKey("deliveryUrl")) {
            val text = map["deliveryUrl"] as? String ?: return null
            parse(text) ?: return null
            text
        } else {
            null
        }
        return MediaTrack(
            index = index,
            type = type,
            displayTitle = cut(displayTitle),
            external = external,
            codec = codec.value,
            language = language.value,
            deliveryUrl = deliveryUrl,
            title = title.value,
            channels = channels.value,
            isDefault = isDefault.value,
            isForced = isForced.value,
            isHearingImpaired = isHearingImpaired.value,
        )
    }

    // An optional field read: `value` is null when the key is absent. The wrapper itself is null for a wrong value.
    private class Optional<T>(val value: T?)

    private fun optionalInt(map: Map<*, *>, key: String, min: Int): Optional<Int>? {
        if (!map.containsKey(key)) return Optional(null)
        val value = integer(map[key]) ?: return null
        return if (value < min) null else Optional(value)
    }

    private fun optionalString(map: Map<*, *>, key: String): Optional<String>? {
        if (!map.containsKey(key)) return Optional(null)
        val value = map[key] as? String ?: return null
        return Optional(cut(value))
    }

    private fun optionalBoolean(map: Map<*, *>, key: String): Optional<Boolean>? {
        if (!map.containsKey(key)) return Optional(null)
        val value = map[key] as? Boolean ?: return null
        return Optional(value)
    }

    // A finite number as Expo hands it over (Double or Int; Long and Float read too), else null.
    internal fun finite(value: Any?): Double? {
        val number = when (value) {
            is Double -> value
            is Int -> value.toDouble()
            is Long -> value.toDouble()
            is Float -> value.toDouble()
            else -> return null
        }
        return if (number.isFinite()) number else null
    }

    // An integral number in Int's range, else null.
    internal fun integer(value: Any?): Int? {
        val number = finite(value) ?: return null
        if (number != Math.floor(number)) return null
        if (number < Int.MIN_VALUE.toDouble() || number > Int.MAX_VALUE.toDouble()) return null
        return number.toInt()
    }

    private fun cut(text: String): String {
        if (text.length <= MAX_STRING) return text
        val end = if (Character.isHighSurrogate(text[MAX_STRING - 1])) MAX_STRING - 1 else MAX_STRING
        return text.substring(0, end)
    }

    // U1: at most 8192 characters, absolute http or https with a host, no user info and no fragment.
    private fun parse(text: String): URI? {
        if (text.isEmpty() || text.length > MAX_URL || text.contains('#')) return null
        val uri = try {
            URI(escapeAfterAuthority(text))
        } catch (_: URISyntaxException) {
            return null
        }
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        if (uri.isOpaque || uri.host.isNullOrEmpty()) return null
        if (uri.rawUserInfo != null || uri.rawFragment != null) return null
        return uri
    }

    private fun escapeAfterAuthority(text: String): String {
        val schemeEnd = text.indexOf("://")
        if (schemeEnd < 0) return text
        val authorityStart = schemeEnd + 3
        val authorityEnd = text.indexOfAny(charArrayOf('/', '?'), authorityStart).let { if (it < 0) text.length else it }
        val rest = StringBuilder()
        for (c in text.substring(authorityEnd)) {
            if (c in PARSE_ESCAPES) rest.append('%').append("%02X".format(c.code)) else rest.append(c)
        }
        return text.substring(0, authorityEnd) + rest
    }

    // U2: one scheme, host (compared in lower case) and effective port for every URL of the request.
    private fun sameOrigin(urls: List<String>): Boolean {
        val origins = urls.map { text ->
            val uri = parse(text) ?: return false
            val scheme = uri.scheme.lowercase()
            val port = if (uri.port >= 0) uri.port else if (scheme == "https") 443 else 80
            Triple(scheme, uri.host.lowercase(), port)
        }
        return origins.toSet().size == 1
    }

    // U3: the S1 path and exactly one `Static` parameter (its name read decoded, compared without case) equal to `true`.
    private fun isOriginalShape(uri: URI): Boolean {
        val path = uri.rawPath ?: return false
        if (!ORIGINAL_PATH.matches(path)) return false
        val query = uri.rawQuery ?: return false
        val statics = query.split('&').filter { it.isNotEmpty() }.mapNotNull { pair ->
            val name = decode(pair.substringBefore('=')) ?: return false
            if (name.lowercase() != "static") return@mapNotNull null
            decode(pair.substringAfter('=', "")) ?: return false
        }
        return statics.size == 1 && statics[0] == "true"
    }

    // The String overload: URLDecoder.decode(String, Charset) needs Android API 33.
    private fun decode(text: String): String? = try {
        URLDecoder.decode(text, "UTF-8")
    } catch (_: Exception) {
        null
    }
}
