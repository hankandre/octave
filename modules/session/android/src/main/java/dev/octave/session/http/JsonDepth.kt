package dev.octave.session.http

// The depth bound on a server's answer (docs/specs/T3-25.md, "The bound" and "The scan"). Depth is the largest number
// of arrays and objects open at one point of the text: a scalar is 0, [] is 1, {"a":[1]} is 2. An answer deeper than
// MAX is refused before it is parsed, because the library's tree reader recurses once per nested array with no count
// and would exhaust the stack; after the bound no answer can raise a StackOverflowError by nesting.
//
// Only a text whose first character after leading whitespace is [ or { is scanned: no other text makes the reader
// recurse, so an HTML error page keeps its status. The scan does not check that the text is JSON; the parser does.
internal object JsonDepth {
    const val MAX = 64

    // True when the text begins with [ or { and more than `max` arrays and objects are open at one point. One pass, no
    // recursion, no allocation. Inside a string, \ skips the next character and " ends the string.
    fun exceeds(text: String, max: Int = MAX): Boolean {
        var index = 0
        val length = text.length
        while (index < length && (text[index] <= ' ' || text[index] == '﻿')) index += 1
        if (index == length || (text[index] != '[' && text[index] != '{')) return false
        var depth = 0
        var inString = false
        while (index < length) {
            val char = text[index]
            if (inString) {
                when (char) {
                    '\\' -> index += 1
                    '"' -> inString = false
                }
            } else {
                when (char) {
                    '"' -> inString = true
                    '[', '{' -> {
                        depth += 1
                        if (depth > max) return true
                    }
                    ']', '}' -> if (depth > 0) depth -= 1
                }
            }
            index += 1
        }
        return false
    }
}
