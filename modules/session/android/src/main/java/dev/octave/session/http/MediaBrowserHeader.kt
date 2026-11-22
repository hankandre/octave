package dev.octave.session.http

// The MediaBrowser Authorization value of packages/core/src/jellyfin/authorization-header.ts, byte for byte: five
// quoted fields in a fixed order, each value encoded as encodeURIComponent does (UTF-8, upper-case hex, with
// A-Z a-z 0-9 - _ . ! ~ * ' ( ) left alone). java.net.URLEncoder differs on space, * and ~, so it is not used.
object MediaBrowserHeader {
    fun build(client: String, device: String, deviceId: String, version: String, token: String): String =
        "MediaBrowser " + listOf("Client" to client, "Device" to device, "DeviceId" to deviceId, "Version" to version, "Token" to token)
            .joinToString(", ") { (name, value) -> "$name=\"${encodeUriComponent(value)}\"" }

    // The tokenless header of decision 0005 ("Before sign-in"): the same five fields with Token="", as
    // packages/core/tests/fixtures/authorization-header.json's expectedWithoutToken. Sent only on the six tokenless calls.
    fun buildTokenless(client: String, device: String, deviceId: String, version: String): String =
        build(client, device, deviceId, version, "")

    // encodeURIComponent refuses a lone surrogate (URIError), and so does this.
    internal fun encodeUriComponent(value: String): String {
        val out = StringBuilder(value.length)
        var index = 0
        while (index < value.length) {
            val char = value[index]
            if (MediaBrowserAuthorization.isUnreserved(char)) {
                out.append(char)
                index += 1
                continue
            }
            val codePoint: Int
            if (Character.isHighSurrogate(char)) {
                require(index + 1 < value.length && Character.isLowSurrogate(value[index + 1])) { "a lone surrogate" }
                codePoint = Character.toCodePoint(char, value[index + 1])
                index += 2
            } else {
                require(!Character.isLowSurrogate(char)) { "a lone surrogate" }
                codePoint = char.code
                index += 1
            }
            for (byte in String(Character.toChars(codePoint)).toByteArray(Charsets.UTF_8)) {
                out.append('%').append(HEX[(byte.toInt() shr 4) and 0xf]).append(HEX[byte.toInt() and 0xf])
            }
        }
        return out.toString()
    }

    private const val HEX = "0123456789ABCDEF"
}
