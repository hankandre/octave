package dev.octave.session.http

import java.io.IOException
import java.io.InterruptedIOException

// The core's seven transport error codes (packages/core/src/ports/transport.ts). Kotlin resolves every outcome as a
// value carrying one of these; no message, class name, URL or header ever goes with it. "cancelled" is never made
// here: cancellation stays in JavaScript (docs/specs/T3-05.md, "The adapter").
internal object TransportCodes {
    const val NETWORK = "network"
    const val TIMEOUT = "timeout"
    const val REDIRECT = "redirect"
    const val CANCELLED = "cancelled"
    const val REFUSED = "refused"
    const val UNEXPECTED_RESPONSE = "unexpected-response"
    const val STATUS = "status"

    val ALL: List<String> = listOf(NETWORK, TIMEOUT, REDIRECT, CANCELLED, REFUSED, UNEXPECTED_RESPONSE, STATUS)

    fun of(refusal: HttpRefusal): String = if (refusal == HttpRefusal.REDIRECT) REDIRECT else REFUSED

    // REDIRECT is redirect; every other refusal is refused; a call timeout or a socket timeout is timeout; an answer
    // that cannot be read or is too large is unexpected-response; any other IOException, and anything else thrown, is
    // network.
    fun of(error: Throwable): String = when (error) {
        is OctaveHttpException -> of(error.refusal)
        is UnusableAnswer -> UNEXPECTED_RESPONSE
        is InterruptedIOException -> TIMEOUT
        is IOException -> NETWORK
        else -> NETWORK
    }
}

// An answer whose body cannot be read whole or is larger than the limit. No message.
internal class UnusableAnswer : IOException()
