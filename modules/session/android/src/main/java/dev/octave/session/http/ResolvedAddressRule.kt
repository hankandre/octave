package dev.octave.session.http

import okhttp3.Dns
import okhttp3.HttpUrl
import java.net.InetAddress

// The one client's only Dns (T3-20, docs/security.md section 3, "Resolved addresses"). Decision 0001 accepts plain
// HTTP by the literal host, before anything is resolved; this rule can only refuse after it. For a plain-HTTP call to
// a name it hands OkHttp only the resolved addresses the shared host-class rule calls loopback or private LAN
// (localhost: loopback only), and refuses with RESOLVED_PUBLIC when none passes, before any socket exists. OkHttp asks
// it for every new connection and builds its routes from the list it returns; an IP-literal host never reaches it.
//
// The Dns is never given the scheme, so SessionInterceptor marks each call's thread with its own scheme for the
// length of chain.proceed. Only a thread marked HTTPS gets its answer back unjudged; no mark means judge.
internal object ResolvedAddressRule : Dns {
    // Where answers come from. Only the module's tests swap it, through the seam below; the judge runs on whatever it
    // returns, so swapping it cannot widen what plain HTTP dials.
    @Volatile
    private var resolver: Dns = Dns.SYSTEM

    // The current thread's call scheme: true inside an HTTPS call's proceed, false inside a plain-HTTP call's, absent
    // outside any call.
    private val httpsMark = ThreadLocal<Boolean?>()

    // Test-only seam: runs `block` with `resolver` as the source of answers, then restores the previous one. Nothing in
    // main source calls it (ResolvedAddressScopeTest scans for it).
    internal fun <T> withResolver(resolver: Dns, block: () -> T): T {
        val previous = this.resolver
        this.resolver = resolver
        try {
            return block()
        } finally {
            this.resolver = previous
        }
    }

    // Runs `block` with the current thread marked by the call's own scheme, and restores what the thread held before.
    // It takes the URL, not a flag, so no caller can mark a plain-HTTP call as HTTPS. A call nested inside another on
    // the same thread overwrites the mark and never inherits the outer call's.
    internal fun <T> proceeding(url: HttpUrl, block: () -> T): T {
        val previous = httpsMark.get()
        httpsMark.set(url.isHttps)
        try {
            return block()
        } finally {
            if (previous == null) httpsMark.remove() else httpsMark.set(previous)
        }
    }

    // The refusal is an OctaveHttpException and must stay one. Dns.lookup declares only UnknownHostException, but
    // Kotlin can throw any IOException from it and OkHttp hands it to execute() unchanged. Turned into an
    // UnknownHostException it would reach the core as network (a server that is off or mistyped), and SessionTransport
    // would resend it once. A resolver failure, a name that does not resolve, passes through unchanged as network.
    override fun lookup(hostname: String): List<InetAddress> {
        val answer = resolver.lookup(hostname)
        if (httpsMark.get() == true) return answer
        if (answer.isEmpty()) return answer
        // A name the classifier calls loopback (localhost) may only reach loopback: decision 0001 asks no confirmation
        // for it because its traffic never leaves the device.
        val loopbackOnly = HostClassifier.parseUrlHost(hostname)?.let { HostClassifier.classify(it) } == HostClass.LOOPBACK
        val passing = answer.filter { passes(classOf(it), loopbackOnly) }
        if (passing.isEmpty()) throw OctaveHttpException(HttpRefusal.RESOLVED_PUBLIC)
        return passing
    }

    private fun passes(hostClass: HostClass, loopbackOnly: Boolean): Boolean = when (hostClass) {
        HostClass.LOOPBACK -> true
        HostClass.PRIVATE_LAN -> !loopbackOnly
        HostClass.PUBLIC -> false
    }

    // The class of an address by its bytes alone. Never getHostName, getCanonicalHostName or toString: the first two
    // can start a reverse lookup, and all three make text this module must not hold.
    private fun classOf(address: InetAddress): HostClass {
        val bytes = address.address
        val host = when (bytes.size) {
            4 -> ParsedHost.Ipv4(IntArray(4) { bytes[it].toInt() and 0xff })
            16 -> ParsedHost.Ipv6(IntArray(8) { ((bytes[2 * it].toInt() and 0xff) shl 8) or (bytes[2 * it + 1].toInt() and 0xff) })
            else -> return HostClass.PUBLIC
        }
        return HostClassifier.classify(host)
    }
}
