package dev.octave.session.http

// Which servers a development build may reach (T3-33; docs/security.md, "Development builds"). A development build is
// one whose app is debuggable. In one, the session module sends nothing to a server unless its host is loopback, the
// emulator host 10.0.2.2, or a host of the build-time allowlist. A release build holds no list and admits every
// address ServerAddress.parse accepted. Plain Kotlin: OctaveSessionModule reads the flag and the list and hands them in.
internal class DevelopmentServers private constructor(private val development: Boolean, private val listed: List<ParsedHost>) {
    // Throws OctaveHttpException(HttpRefusal.DEVELOPMENT_BUILD) when this is a development build and the host does not
    // qualify. `address` has passed ServerAddress.parse, so its host is the host OkHttp dials.
    fun check(address: ServerAddress) {
        if (!development) return
        val host = HostClassifier.parseUrlHost(address.host) ?: refuse()
        if (qualifies(host)) return
        refuse()
    }

    private fun qualifies(host: ParsedHost): Boolean {
        if (HostClassifier.classify(host) == HostClass.LOOPBACK) return true
        if (same(host, EMULATOR_HOST)) return true
        return listed.any { same(host, it) }
    }

    override fun toString(): String = "DevelopmentServers([redacted])"

    companion object {
        private val EMULATOR_HOST = ParsedHost.Ipv4(intArrayOf(10, 0, 2, 2))

        // allowlist: the comma-separated text of BuildConfig.OCTAVE_DEV_SERVERS. It is not read when debuggable is false.
        fun forBuild(debuggable: Boolean, allowlist: String): DevelopmentServers {
            if (!debuggable) return DevelopmentServers(false, emptyList())
            val listed = allowlist.split(',').mapNotNull { entry(HostClassifier.jsTrim(it)) }
            return DevelopmentServers(true, listed)
        }

        // One exact host: a name, an IPv4 literal, or an IPv6 literal in brackets. No scheme, port, path, wildcard or
        // range; anything else admits nothing.
        private fun entry(text: String): ParsedHost? {
            if (text.isEmpty()) return null
            if (!ENTRY.matches(text)) return null
            return HostClassifier.parseServerHost("http://$text/")
        }

        // A name or IPv4 literal of letters, digits, dots, hyphens and underscores, or a bracketed IPv6 literal.
        private val ENTRY = Regex("""^(?:[A-Za-z0-9._-]+|\[[0-9A-Fa-f:.]+\])\z""")

        // IPv4 by octets, IPv6 by groups (an IPv4-mapped address compares as its IPv4 address), a name by its
        // lower-cased text.
        private fun same(a: ParsedHost, b: ParsedHost): Boolean {
            val left = asIpv4(a) ?: a
            val right = asIpv4(b) ?: b
            return when (left) {
                is ParsedHost.Ipv4 -> right is ParsedHost.Ipv4 && left.octets.contentEquals(right.octets)
                is ParsedHost.Ipv6 -> right is ParsedHost.Ipv6 && left.groups.contentEquals(right.groups)
                is ParsedHost.Name -> right is ParsedHost.Name && left.name == right.name
            }
        }

        private fun asIpv4(host: ParsedHost): ParsedHost.Ipv4? = (host as? ParsedHost.Ipv6)?.mappedIpv4

        private fun refuse(): Nothing = throw OctaveHttpException(HttpRefusal.DEVELOPMENT_BUILD)
    }
}
