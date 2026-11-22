package dev.octave.session.http

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

// The path rule of the native request (T3-16; docs/specs/T3-16.md, "The path rule"). A path is safe only when all hold:
//   P1. It starts with / and not with //, and holds no ? or #.
//   P2. It holds no backslash (OkHttp reads \ as a separator).
//   P3. It holds no character below U+0020 and no U+007F.
//   P4. No segment is . or .., as written or after up to four rounds of percent-decoding, split on / and \.
//   P5. Every % begins two hex digits, and the escapes of the path as written decode to UTF-8.
// The core's reference transport applies the same rule (packages/core/src/adapters/request-path.ts); both pass the
// vectors of packages/core/tests/fixtures/request-paths.json. Containment beyond this is ServerAddress.url (C1) and
// RequestPolicy (C2).
internal object RequestPath {
    // As many rounds as the token search looks through (RequestPolicy).
    private const val DECODING_ROUNDS = 4

    fun isSafe(path: String): Boolean {
        if (!path.startsWith("/") || path.startsWith("//") || path.contains('?') || path.contains('#')) return false
        if (path.contains('\\')) return false
        if (path.any { it < ' ' || it == '\u007f' }) return false
        if (!escapesAreUtf8(path)) return false
        var text = path
        for (round in 0..DECODING_ROUNDS) {
            if (text.split('/', '\\').any { it == "." || it == ".." }) return false
            if (!text.contains('%')) break
            text = PercentDecoding.decode(text)
        }
        return true
    }

    // P5: each % begins two ASCII hex digits, and the bytes the path names decode as UTF-8 (no overlong form, no
    // encoded surrogate), as decodeURIComponent requires.
    private fun escapesAreUtf8(path: String): Boolean {
        if (!path.contains('%')) return true
        val bytes = ByteArrayOutputStream(path.length)
        var index = 0
        while (index < path.length) {
            val char = path[index]
            if (char == '%') {
                if (index + 2 >= path.length) return false
                val high = hexDigit(path[index + 1])
                val low = hexDigit(path[index + 2])
                if (high < 0 || low < 0) return false
                bytes.write((high shl 4) or low)
                index += 3
                continue
            }
            val end = if (Character.isHighSurrogate(char) && index + 1 < path.length) index + 2 else index + 1
            bytes.write(path.substring(index, end).toByteArray(Charsets.UTF_8))
            index = end
        }
        val decoder = Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
        return try {
            decoder.decode(ByteBuffer.wrap(bytes.toByteArray()))
            true
        } catch (_: CharacterCodingException) {
            false
        }
    }

    private fun hexDigit(char: Char): Int = when (char) {
        in '0'..'9' -> char - '0'
        in 'a'..'f' -> char - 'a' + 10
        in 'A'..'F' -> char - 'A' + 10
        else -> -1
    }
}
