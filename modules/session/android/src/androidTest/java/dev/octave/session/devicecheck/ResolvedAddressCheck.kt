package dev.octave.session.devicecheck

import android.os.Bundle
import dev.octave.session.http.MediaBrowserAuthorization
import dev.octave.session.http.OctaveHttp
import dev.octave.session.http.OctaveHttpException
import dev.octave.session.http.ResolvedAddressRule
import dev.octave.session.http.SessionRegistry
import okhttp3.Dns
import okhttp3.Request
import java.net.InetAddress
import java.net.UnknownHostException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

// T3-20's device check (docs/specs/T3-20.md, "The emulator check"), run by CleartextProbe with -e check
// resolved-address. The emulator's resolver is the host's and nothing in pnpm tv:e2e can change it, so the check puts
// a fixed answer table behind the one client's resolved-address rule through its test-only seam, and sends through
// the one client: one name and one session per case, so no case rides another's pooled connection. Every connection
// goes to 10.0.2.2, the host's own test server; nothing here dials a public address. It reports fixed words, statuses,
// counts and class names only, never an address, a host, a header or an exception message, and logs nothing.
internal class ResolvedAddressCheck(private val port: Int, private val canary: () -> MediaBrowserAuthorization) {
    private val hostServer: InetAddress = InetAddress.getByAddress(byteArrayOf(10, 0, 2, 2))
    private val public: InetAddress = InetAddress.getByAddress(byteArrayOf(203.toByte(), 0, 113, 7))
    private val asked: MutableSet<String> = ConcurrentHashMap.newKeySet()
    private val reentries = ConcurrentHashMap<String, String>()

    // The fixed answer table. Asked for the private or the TLS name, it first re-enters the rule with a lookup of the
    // outside name on the thread it is on: a plain-HTTP call's lookup must refuse it, an HTTPS call's must not judge it.
    private val table = object : Dns {
        override fun lookup(hostname: String): List<InetAddress> {
            asked.add(hostname)
            return when (hostname) {
                PRIVATE, TLS -> {
                    reentries[hostname] = reenter()
                    listOf(hostServer)
                }
                MIXED -> listOf(public, hostServer)
                PUBLIC, OUTSIDE -> listOf(public)
                else -> throw UnknownHostException("not in the probe's table")
            }
        }
    }

    private fun reenter(): String = try {
        val answer = ResolvedAddressRule.lookup(OUTSIDE)
        if (answer.size == 1 && answer.single() == public) "unjudged" else "filtered"
    } catch (refused: OctaveHttpException) {
        "refused-${refused.refusal.code}"
    } catch (error: Exception) {
        "failed-${error.javaClass.simpleName}"
    }

    fun run(results: Bundle) {
        ResolvedAddressRule.withResolver(table) {
            results.putString("resolved-private", get("http://$PRIVATE:$port", "/octave-probe/resolved-private"))
            results.putString("resolved-mixed", get("http://$MIXED:$port", "/octave-probe/resolved-mixed"))
            results.putString("resolved-public", get("http://$PUBLIC:$port", "/octave-probe/resolved-public"))
            results.putString("resolved-asked", listOf(PRIVATE, MIXED, PUBLIC).count { it in asked }.toString())
            results.putString("http-outside", reentries[PRIVATE] ?: "not-run")
            results.putString("https-call", get("https://$TLS:$port", "/octave-probe/https-call"))
            results.putString("https-asked", if (TLS in asked) "yes" else "no")
            results.putString("https-outside", reentries[TLS] ?: "not-run")
        }
    }

    // One GET through the one client for a session opened at base: the status, refused-<code>, or failed-<class>.
    private fun get(base: String, path: String): String {
        val session = try {
            SessionRegistry.open(base, canary())
        } catch (refused: OctaveHttpException) {
            return "refused-${refused.refusal.code}"
        } catch (error: Exception) {
            return "failed-${error.javaClass.simpleName}"
        }
        try {
            val call = OctaveHttp.callFactory(session).newCall(Request.Builder().url("$base$path").get().build())
            call.timeout().timeout(CALL_SECONDS, TimeUnit.SECONDS)
            call.execute().use { response -> return response.code.toString() }
        } catch (refused: OctaveHttpException) {
            return "refused-${refused.refusal.code}"
        } catch (error: Exception) {
            return "failed-${error.javaClass.simpleName}"
        } finally {
            SessionRegistry.close(session)
        }
    }

    private companion object {
        const val PRIVATE = "octave-probe-private.home.arpa"
        const val MIXED = "octave-probe-mixed.home.arpa"
        const val PUBLIC = "octave-probe-public.home.arpa"
        const val TLS = "octave-probe-tls.home.arpa"
        const val OUTSIDE = "octave-probe-outside.home.arpa"
        const val CALL_SECONDS = 20L
    }
}
