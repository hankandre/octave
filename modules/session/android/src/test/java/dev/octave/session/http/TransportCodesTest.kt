package dev.octave.session.http

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

// T3-05 item 5, the Kotlin half: every refusal and every exception maps to one of the core's seven codes, and a
// result never carries a message.
class TransportCodesTest {
    @Test
    fun the_codes_are_the_core_s_seven() {
        val port = TestSupport.repoFile("packages/core/src/ports/transport.ts").readText()
        val union = Regex("""export type TransportErrorCode =([^;]*);""").find(port)!!.groupValues[1]
        val codes = Regex(""""([a-z-]+)"""").findAll(union).map { it.groupValues[1] }.toList()
        assertEquals(codes.sorted(), TransportCodes.ALL.sorted())
        assertEquals(7, TransportCodes.ALL.size)
    }

    @Test
    fun a_redirect_refusal_is_redirect_and_every_other_refusal_is_refused() {
        for (refusal in HttpRefusal.entries) {
            val expected = if (refusal == HttpRefusal.REDIRECT) "redirect" else "refused"
            assertEquals(expected, TransportCodes.of(refusal), refusal.name)
            assertEquals(expected, TransportCodes.of(OctaveHttpException(refusal)), refusal.name)
        }
    }

    @Test
    fun each_exception_class_maps_to_its_code() {
        val cases = listOf(
            SocketTimeoutException("connect timed out http://192.168.1.20:8096") to "timeout",
            InterruptedIOException("timeout") to "timeout",
            ConnectException("Failed to connect to /192.168.1.20:8096") to "network",
            UnknownHostException("media.example") to "network",
            IOException("unexpected end of stream") to "network",
            UnusableAnswer() to "unexpected-response",
            IllegalStateException("boom") to "network",
            OutOfMemoryError() to "network",
        )
        for ((error, code) in cases) assertEquals(code, TransportCodes.of(error), error.javaClass.name)
    }
}
