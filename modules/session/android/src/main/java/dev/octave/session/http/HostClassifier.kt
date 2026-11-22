package dev.octave.session.http

import java.math.BigInteger

enum class HostClass(val wire: String) { LOOPBACK("loopback"), PRIVATE_LAN("private-lan"), PUBLIC("public") }

// A host as the classifier read it: an IPv4 address, an IPv6 address as eight 16-bit groups, or a lower-cased name.
internal sealed class ParsedHost {
    class Ipv4(val octets: IntArray) : ParsedHost() {
        val dotted: String get() = octets.joinToString(".")
    }

    class Ipv6(val groups: IntArray) : ParsedHost() {
        // ::ffff:a.b.c.d, which takes the class of the embedded IPv4 address.
        val mappedIpv4: Ipv4?
            get() = if ((0..4).all { groups[it] == 0 } && groups[5] == 0xffff) {
                Ipv4(intArrayOf(groups[6] shr 8, groups[6] and 0xff, groups[7] shr 8, groups[7] and 0xff))
            } else {
                null
            }
    }

    class Name(val name: String) : ParsedHost()
}

// The host rules R1 to R3 of packages/core/tests/fixtures/README.md, as packages/core/src/domain/host-class.ts
// applies them, with a host parser of its own: no HttpUrl (it maps IDNA and rewrites IPv6 literals) and no InetAddress
// (a DNS answer, which decision 0001 forbids for accepting a host). Every rule here passes
// packages/core/tests/fixtures/host-classes.json. ResolvedAddressRule (T3-20) hands classify the bytes of a resolved
// address as a ParsedHost, only to refuse; nothing here takes an InetAddress.
object HostClassifier {
    // R1, plain ASCII authority. No case-insensitive or Unicode option; \z, because Java's $ also matches before a
    // final line break.
    private val PLAIN_ASCII_AUTHORITY =
        Regex("""^[Hh][Tt][Tt][Pp][Ss]?://([A-Za-z0-9._-]+|\[[0-9A-Fa-f:.]+\])(?::([0-9]*))?(?:[/?#]|\z)""")
    private val PLAIN_ASCII_NAME = Regex("""^[a-z0-9._-]+$""")
    private val DOTTED_IPV4 = Regex("""^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$""")

    // R3: the class of a server address as the user wrote it.
    fun classifyServerAddress(address: String): HostClass {
        val host = parseServerHost(address) ?: return HostClass.PUBLIC
        return classify(host)
    }

    // The characters JavaScript's String.prototype.trim removes; Kotlin's trim() also removes U+001C to U+001F.
    internal fun jsTrim(text: String): String {
        var start = 0
        var end = text.length
        while (start < end && isJsWhitespace(text[start])) start++
        while (end > start && isJsWhitespace(text[end - 1])) end--
        return text.substring(start, end)
    }

    private fun isJsWhitespace(char: Char): Boolean = when (char) {
        in '\u0009'..'\u000D', ' ', ' ', ' ', in ' '..' ', ' ', ' ', ' ', ' ', '　', '﻿' -> true
        else -> false
    }

    internal fun hasPlainAsciiAuthority(address: String): Boolean = PLAIN_ASCII_AUTHORITY.containsMatchIn(jsTrim(address))

    // The host of a server address as the WHATWG URL parser would read it, or null when R1 fails or that parser
    // would fail (which makes the address public).
    internal fun parseServerHost(address: String): ParsedHost? {
        val match = PLAIN_ASCII_AUTHORITY.find(jsTrim(address)) ?: return null
        val host = match.groupValues[1]
        val port = match.groupValues[2]
        if (port.isNotEmpty() && !isPort(port)) return null
        if (host.startsWith("[")) return parseIpv6(host.substring(1, host.length - 1))?.let { ParsedHost.Ipv6(it) }
        val lower = host.lowercase()
        if (endsInNumber(lower)) return parseWhatwgIpv4(lower)?.let { ParsedHost.Ipv4(it) }
        return ParsedHost.Name(lower)
    }

    // A host as OkHttp's HttpUrl.host holds it: an IPv6 address has no brackets, an IPv4 address is dotted decimal.
    internal fun parseUrlHost(host: String): ParsedHost? {
        if (host.contains(':')) return parseIpv6(host)?.let { ParsedHost.Ipv6(it) }
        DOTTED_IPV4.matchEntire(host)?.let { match ->
            val octets = match.groupValues.drop(1).map { it.toInt() }
            return if (octets.all { it <= 255 }) ParsedHost.Ipv4(octets.toIntArray()) else null
        }
        return ParsedHost.Name(host.lowercase())
    }

    internal fun classify(host: ParsedHost): HostClass = when (host) {
        is ParsedHost.Ipv4 -> classifyIpv4(host.octets)
        is ParsedHost.Ipv6 -> classifyIpv6(host)
        is ParsedHost.Name -> classifyName(host.name)
    }

    private fun isPort(digits: String): Boolean {
        val significant = digits.trimStart('0')
        return significant.length <= 5 && (significant.isEmpty() || significant.toInt() <= 65535)
    }

    // The WHATWG "ends in a number" check: the last label, ignoring one trailing empty label, is all digits or a
    // 0x number.
    private fun endsInNumber(host: String): Boolean {
        val parts = host.split('.').toMutableList()
        if (parts.last().isEmpty()) {
            if (parts.size == 1) return false
            parts.removeAt(parts.size - 1)
        }
        val last = parts.last()
        if (last.isNotEmpty() && last.all { it in '0'..'9' }) return true
        return parseIpv4Number(last) != null && (last.startsWith("0x") || last.startsWith("0X"))
    }

    // The WHATWG IPv4 parser: one to four parts, each decimal, 0x hex or leading-zero octal; the last part fills the
    // remaining bytes.
    private fun parseWhatwgIpv4(host: String): IntArray? {
        val parts = host.split('.').toMutableList()
        if (parts.last().isEmpty() && parts.size > 1) parts.removeAt(parts.size - 1)
        if (parts.size > 4) return null
        val numbers = parts.map { parseIpv4Number(it) ?: return null }
        val byte = BigInteger.valueOf(255)
        if (numbers.dropLast(1).any { it > byte }) return null
        val last = numbers.last()
        if (last >= BigInteger.valueOf(256).pow(5 - numbers.size)) return null
        var address = last.toLong()
        numbers.dropLast(1).forEachIndexed { index, part -> address += part.toLong() shl (8 * (3 - index)) }
        return IntArray(4) { ((address shr (8 * (3 - it))) and 0xff).toInt() }
    }

    private fun parseIpv4Number(text: String): BigInteger? {
        if (text.isEmpty()) return null
        var input = text
        var radix = 10
        if (input.length >= 2 && (input.startsWith("0x") || input.startsWith("0X"))) {
            input = input.substring(2)
            radix = 16
        } else if (input.length >= 2 && input.startsWith("0")) {
            input = input.substring(1)
            radix = 8
        }
        if (input.isEmpty()) return BigInteger.ZERO
        if (!input.all { Character.digit(it, radix) >= 0 && it.code < 128 }) return null
        return BigInteger(input, radix)
    }

    // An IPv6 literal without brackets: hex groups of one to four digits, at most one ::, and an optional dotted
    // decimal IPv4 tail. Returns eight 16-bit groups, or null.
    internal fun parseIpv6(text: String): IntArray? {
        val halves = text.split("::")
        if (halves.size > 2) return null
        val front = parseIpv6Part(halves[0], tailAllowed = halves.size == 1) ?: return null
        if (halves.size == 1) return if (front.size == 8) front.toIntArray() else null
        val back = parseIpv6Part(halves[1], tailAllowed = true) ?: return null
        val missing = 8 - front.size - back.size
        if (missing < 1) return null
        return (front + List(missing) { 0 } + back).toIntArray()
    }

    private fun parseIpv6Part(part: String, tailAllowed: Boolean): List<Int>? {
        if (part.isEmpty()) return emptyList()
        val pieces = part.split(':')
        val groups = mutableListOf<Int>()
        pieces.forEachIndexed { index, piece ->
            if (piece.contains('.')) {
                if (!tailAllowed || index != pieces.size - 1) return null
                val octets = parseIpv6Ipv4Tail(piece) ?: return null
                groups.add((octets[0] shl 8) or octets[1])
                groups.add((octets[2] shl 8) or octets[3])
            } else {
                if (piece.isEmpty() || piece.length > 4 || !piece.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) return null
                groups.add(piece.toInt(16))
            }
        }
        return groups
    }

    // The IPv4 tail of an IPv6 literal: exactly four decimal parts with no leading zero.
    private fun parseIpv6Ipv4Tail(text: String): IntArray? {
        val parts = text.split('.')
        if (parts.size != 4) return null
        val octets = parts.map { part ->
            if (part.isEmpty() || part.length > 3 || !part.all { it in '0'..'9' } || (part.length > 1 && part[0] == '0')) return null
            part.toInt().takeIf { it <= 255 } ?: return null
        }
        return octets.toIntArray()
    }

    private fun classifyIpv4(octets: IntArray): HostClass {
        val a = octets[0]
        val b = octets[1]
        return when {
            a == 127 -> HostClass.LOOPBACK
            a == 10 -> HostClass.PRIVATE_LAN
            a == 172 && b in 16..31 -> HostClass.PRIVATE_LAN
            a == 192 && b == 168 -> HostClass.PRIVATE_LAN
            a == 169 && b == 254 -> HostClass.PRIVATE_LAN
            else -> HostClass.PUBLIC
        }
    }

    private fun classifyIpv6(host: ParsedHost.Ipv6): HostClass {
        val groups = host.groups
        if ((0..6).all { groups[it] == 0 } && groups[7] == 1) return HostClass.LOOPBACK
        host.mappedIpv4?.let { return classifyIpv4(it.octets) }
        if ((groups[0] and 0xfe00) == 0xfc00) return HostClass.PRIVATE_LAN
        if ((groups[0] and 0xffc0) == 0xfe80) return HostClass.PRIVATE_LAN
        return HostClass.PUBLIC
    }

    // R2 and the name rules of classifyDomain.
    private fun classifyName(host: String): HostClass {
        if (!PLAIN_ASCII_NAME.matches(host)) return HostClass.PUBLIC
        if (host == "localhost") return HostClass.LOOPBACK
        val name = if (host.endsWith(".")) host.dropLast(1) else host
        val labels = name.split('.')
        if (labels.any { it.isEmpty() }) return HostClass.PUBLIC
        if (labels.any { it.startsWith("xn--") }) return HostClass.PUBLIC
        val count = labels.size
        if (count >= 2 && labels[count - 1] == "local") return HostClass.PRIVATE_LAN
        if (count >= 3 && labels[count - 2] == "home" && labels[count - 1] == "arpa") return HostClass.PRIVATE_LAN
        return HostClass.PUBLIC
    }
}
