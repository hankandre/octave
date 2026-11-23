package dev.octave.player.seam

// A small JSON reader for the shared fixtures, so the player module's tests need no JSON library. Objects become
// Map<String, Any?>, arrays List<Any?>, every number a Double (as Expo hands JavaScript numbers to Kotlin), and
// strings, booleans and null themselves.
object TestJson {
    fun parse(text: String): Any? {
        val reader = Reader(text)
        val value = reader.value()
        reader.skipSpace()
        check(reader.at == text.length) { "trailing text at ${reader.at}" }
        return value
    }

    private class Reader(val text: String) {
        var at = 0

        fun skipSpace() {
            while (at < text.length && text[at].isWhitespace()) at += 1
        }

        fun value(): Any? {
            skipSpace()
            check(at < text.length) { "unexpected end" }
            return when (val c = text[at]) {
                '{' -> obj()
                '[' -> array()
                '"' -> string()
                't' -> literal("true", true)
                'f' -> literal("false", false)
                'n' -> literal("null", null)
                else -> if (c == '-' || c.isDigit()) number() else error("unexpected '$c' at $at")
            }
        }

        private fun literal(word: String, value: Any?): Any? {
            check(text.startsWith(word, at)) { "bad literal at $at" }
            at += word.length
            return value
        }

        private fun number(): Double {
            val start = at
            while (at < text.length && (text[at].isDigit() || text[at] in "+-.eE")) at += 1
            return text.substring(start, at).toDouble()
        }

        private fun string(): String {
            at += 1
            val out = StringBuilder()
            while (true) {
                check(at < text.length) { "unterminated string" }
                val c = text[at]
                at += 1
                when (c) {
                    '"' -> return out.toString()
                    '\\' -> {
                        val e = text[at]
                        at += 1
                        when (e) {
                            'n' -> out.append('\n')
                            't' -> out.append('\t')
                            'r' -> out.append('\r')
                            'b' -> out.append('\b')
                            'f' -> out.append('\u000c')
                            'u' -> {
                                out.append(text.substring(at, at + 4).toInt(16).toChar())
                                at += 4
                            }
                            else -> out.append(e)
                        }
                    }
                    else -> out.append(c)
                }
            }
        }

        private fun array(): List<Any?> {
            at += 1
            val out = mutableListOf<Any?>()
            skipSpace()
            if (text[at] == ']') {
                at += 1
                return out
            }
            while (true) {
                out += value()
                skipSpace()
                val c = text[at]
                at += 1
                if (c == ']') return out
                check(c == ',') { "expected , at ${at - 1}" }
            }
        }

        private fun obj(): Map<String, Any?> {
            at += 1
            val out = linkedMapOf<String, Any?>()
            skipSpace()
            if (text[at] == '}') {
                at += 1
                return out
            }
            while (true) {
                skipSpace()
                val key = string()
                skipSpace()
                check(text[at] == ':') { "expected : at $at" }
                at += 1
                out[key] = value()
                skipSpace()
                val c = text[at]
                at += 1
                if (c == '}') return out
                check(c == ',') { "expected , at ${at - 1}" }
            }
        }
    }
}
