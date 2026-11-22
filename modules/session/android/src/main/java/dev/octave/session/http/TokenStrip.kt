package dev.octave.session.http

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// Removes a session's token from a parsed answer before it crosses to JavaScript (decision 0005, "The seam"): every
// string and every key, in the forms the reference adapter strips (as written, percent-encoded with upper-case and
// lower-case hex, and query-encoded), replaced with [redacted]. The answer is parsed first, so a JSON escape cannot
// hide the token from the filter.
internal object TokenStrip {
    const val REDACTED: String = "[redacted]"

    fun forms(token: String): List<String> {
        if (token.isEmpty()) return emptyList()
        val encoded = MediaBrowserHeader.encodeUriComponent(token)
        val lower = Regex("%[0-9A-F]{2}").replace(encoded) { it.value.lowercase() }
        return listOf(token, encoded, lower, QueryEncoding.encodePart(token)).distinct()
    }

    // The forms of the token an authorization carries.
    fun forms(authorization: MediaBrowserAuthorization): List<String> = forms(PercentDecoding.decode(authorization.writtenToken()))

    fun clean(text: String, forms: List<String>): String = forms.fold(text) { current, form -> current.replace(form, REDACTED) }

    fun strip(element: JsonElement, forms: List<String>): JsonElement {
        if (forms.isEmpty()) return element
        return when (element) {
            is JsonObject -> JsonObject(element.entries.associate { (key, value) -> clean(key, forms) to strip(value, forms) })
            is JsonArray -> JsonArray(element.map { strip(it, forms) })
            is JsonPrimitive -> when {
                element.isString -> JsonPrimitive(clean(element.content, forms))
                // A number that holds a form of the token becomes the marker, as a string.
                forms.any { element.content.contains(it) } -> JsonPrimitive(REDACTED)
                else -> element
            }
        }
    }
}
