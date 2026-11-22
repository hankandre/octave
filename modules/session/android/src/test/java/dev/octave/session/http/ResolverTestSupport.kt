package dev.octave.session.http

import okhttp3.Call
import okhttp3.Dns
import okhttp3.Request
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.fail
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Method
import java.net.InetAddress
import java.net.UnknownHostException
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit

// Shared helpers for the frozen T3-20 tests (docs/specs/T3-20.md, "The resolver seam" and "What the JVM tests dial").
//
// - The seam is reached by reflection: the one client's Dns must have one method whose JVM name starts with
//   withResolver (Kotlin appends the module name to an internal function's name), taking a Dns and a block. With none,
//   every case fails with "the one client's Dns has no resolver seam". No frozen file names the rule, the seam or the
//   new refusal as a symbol; a refusal is compared by its code string.
// - Addresses are built with InetAddress.getByAddress from bytes, never by a name lookup. The only address a call
//   that may connect is ever given is 127.0.0.1; every other address is given only where the lookup must refuse or
//   filter it before a socket exists, or to a lookup that no call is waiting on.
// - The pool reuses a connection by name and port and never asks again, so a case that expects a lookup uses its own
//   server (a new port) or empties the pool first, and asserts what the resolver was asked.
internal object ResolverTestSupport {
    const val RESOLVED_PUBLIC = "resolved-public"
    private const val SEAM_PREFIX = "withResolver"
    private const val WAIT_SECONDS = 20L

    // 203.0.113.7 is TEST-NET-3 (RFC 5737): public, and never dialled by these tests.
    // One object each, so a case can check that the rule hands back the very object the fake gave.
    val PUBLIC: InetAddress = address(203, 0, 113, 7)
    val LOOPBACK: InetAddress = address(127, 0, 0, 1)

    fun address(vararg bytes: Int): InetAddress = InetAddress.getByAddress(ByteArray(bytes.size) { bytes[it].toByte() })

    // An IPv6 address from eight 16-bit groups, high byte first.
    fun ipv6(vararg groups: Int): InetAddress {
        require(groups.size == 8) { "eight groups" }
        val bytes = ByteArray(16)
        for ((index, group) in groups.withIndex()) {
            bytes[2 * index] = (group shr 8).toByte()
            bytes[2 * index + 1] = (group and 0xff).toByte()
        }
        return InetAddress.getByAddress(bytes)
    }

    // A fake resolver that records every name it was asked, in order, and answers from `answers`.
    class RecordingResolver(private val answers: (String) -> List<InetAddress>) : Dns {
        val asked = CopyOnWriteArrayList<String>()

        override fun lookup(hostname: String): List<InetAddress> {
            asked.add(hostname)
            return answers(hostname)
        }

        fun count(name: String): Int = asked.count { it == name }
    }

    // An answer table: each listed name has its answer; any other name is UnknownHostException.
    fun table(vararg entries: Pair<String, List<InetAddress>>): (String) -> List<InetAddress> {
        val map = entries.toMap()
        return { name -> map[name] ?: throw UnknownHostException("not in the test table") }
    }

    private fun seam(): Pair<Dns, Method> {
        val dns = OctaveHttp.client.dns
        val methods = dns.javaClass.methods.filter { it.name.startsWith(SEAM_PREFIX) && !it.isSynthetic && it.parameterCount == 2 }
        val method = methods.singleOrNull() ?: fail<Method>("the one client's Dns has no resolver seam")
        method.isAccessible = true
        return dns to method
    }

    // Runs `block` with `resolver` as the source of answers for the one client's Dns, through the seam.
    fun <T> withResolver(resolver: Dns, block: () -> T): T {
        val (dns, method) = seam()
        var result: Any? = null
        val wrapped: () -> Any? = {
            result = block()
            result
        }
        try {
            method.invoke(dns, resolver, wrapped)
        } catch (error: InvocationTargetException) {
            throw error.targetException
        }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    // Runs `block` with a recording resolver that answers from `answers`; the block gets the recorder.
    fun <T> withAnswers(answers: (String) -> List<InetAddress>, block: (RecordingResolver) -> T): T {
        val resolver = RecordingResolver(answers)
        return withResolver(resolver) { block(resolver) }
    }

    fun emptyPool() = OctaveHttp.client.connectionPool.evictAll()

    // What a lookup through the one client's Dns gave: the list, the refusal's code, or another failure's class.
    sealed class Lookup {
        class Answer(val addresses: List<InetAddress>) : Lookup()

        class Refused(val code: String) : Lookup()

        class Failed(val error: Throwable) : Lookup()
    }

    // Calls OctaveHttp.client.dns.lookup(name) where it stands (on the calling thread, inside whatever call it is in),
    // and never throws, so the outer call's result does not depend on it.
    fun reenter(name: String): Lookup = try {
        Lookup.Answer(OctaveHttp.client.dns.lookup(name))
    } catch (error: OctaveHttpException) {
        Lookup.Refused(error.refusal.code)
    } catch (error: Throwable) {
        Lookup.Failed(error)
    }

    // The lookup gave exactly the one public address object that the fake answered with: it was not judged.
    fun assertUnjudged(lookup: Lookup?, what: String) {
        assertTrue(lookup is Lookup.Answer, "$what: the lookup returned an answer, not ${describe(lookup)}")
        val addresses = (lookup as Lookup.Answer).addresses
        assertEquals(1, addresses.size, "$what: one address")
        assertSame(PUBLIC, addresses.single(), "$what: the public address object the fake gave")
    }

    // The lookup was refused with resolved-public: it was judged.
    fun assertJudgedAndRefused(lookup: Lookup?, what: String) {
        assertTrue(lookup is Lookup.Refused, "$what: the lookup was refused, not ${describe(lookup)}")
        assertEquals(RESOLVED_PUBLIC, (lookup as Lookup.Refused).code, "$what: the refusal's code")
    }

    private fun describe(lookup: Lookup?): String = when (lookup) {
        null -> "never run"
        is Lookup.Answer -> "an answer of ${lookup.addresses.size} address(es)"
        is Lookup.Refused -> "refused ${lookup.code}"
        is Lookup.Failed -> "failed with ${lookup.error.javaClass.simpleName}"
    }

    // Runs `block`, which must throw an OctaveHttpException whose code is resolved-public, and returns it.
    fun refusedResolvedPublic(block: () -> Unit): OctaveHttpException {
        val error = assertThrows(OctaveHttpException::class.java) { block() }
        assertEquals(RESOLVED_PUBLIC, error.refusal.code, "the refusal's code")
        return error
    }

    // The refusal carries no address, host name or port: its message is the code, it has no cause and no suppressed
    // exception that holds one.
    fun assertCarriesNothing(error: OctaveHttpException, vararg secrets: String) {
        assertFalse(error is UnknownHostException, "the refusal is not an UnknownHostException")
        assertEquals(RESOLVED_PUBLIC, error.message, "the message is the code")
        assertNull(error.cause, "the refusal has no cause")
        val texts = listOf(error.toString(), error.message.orEmpty(), error.localizedMessage.orEmpty()) +
            error.suppressed.flatMap { listOf(it.toString(), it.message.orEmpty()) }
        for (secret in listOf("203.0.113") + secrets) {
            for (text in texts) assertFalse(text.contains(secret), "the refusal holds $secret")
        }
    }

    // One HTTPS GET with a deadline, so a server that never answers the TLS hello fails the case instead of hanging.
    // Returns what it threw, or null when an answer came back.
    fun httpsAttempt(factory: Call.Factory, url: String): Throwable? {
        val call = factory.newCall(Request.Builder().url(url).build())
        call.timeout().timeout(WAIT_SECONDS, TimeUnit.SECONDS)
        return try {
            call.execute().close()
            null
        } catch (error: Throwable) {
            error
        }
    }

    // The HTTPS call failed with an IOException that is not a refusal (the server speaks no TLS).
    fun assertFailedNotRefused(error: Throwable?, what: String) {
        assertTrue(error != null, "$what: the HTTPS call to a plain server failed")
        assertTrue(error is java.io.IOException, "$what: an IOException, not ${error!!.javaClass.name}")
        assertFalse(error is OctaveHttpException, "$what: not refused (${(error as? OctaveHttpException)?.refusal?.code})")
    }

    fun await(latch: java.util.concurrent.CountDownLatch, what: String) {
        assertTrue(latch.await(WAIT_SECONDS, TimeUnit.SECONDS), "timed out waiting for $what")
    }

    val waitSeconds: Long get() = WAIT_SECONDS

    fun assertSameList(expected: List<InetAddress>, actual: List<InetAddress>, what: String) {
        assertEquals(expected, actual, what)
        for ((index, address) in expected.withIndex()) assertSame(address, actual[index], "$what: the same object at $index")
    }
}
