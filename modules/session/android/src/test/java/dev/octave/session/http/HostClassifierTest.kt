package dev.octave.session.http

import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

// T3-03: the classifier's own parsers, beyond the shared vectors that HostClassTest runs.
class HostClassifierTest {
    private fun classOf(address: String) = HostClassifier.classifyServerAddress(address)

    @Test
    fun javascript_trim_is_used_not_kotlin_trim() {
        assertEquals(HostClass.LOOPBACK, classOf("　﻿ http://127.0.0.1/  "))
        assertEquals(HostClass.PUBLIC, classOf("\u001Chttp://127.0.0.1/"), "U+001C is not trimmed by JavaScript")
    }

    @Test
    fun ports_beyond_65535_and_trailing_line_breaks_are_public() {
        assertEquals(HostClass.LOOPBACK, classOf("http://127.0.0.1:65535"))
        assertEquals(HostClass.LOOPBACK, classOf("http://127.0.0.1:"))
        assertEquals(HostClass.LOOPBACK, classOf("http://127.0.0.1:0000008096/"))
        assertEquals(HostClass.PUBLIC, classOf("http://127.0.0.1:65536"))
        assertEquals(HostClass.PUBLIC, classOf("http://127.0.0.1:99999999999999999999"))
        assertEquals(HostClass.PUBLIC, classOf("http://127.0.0.1\u0085"))
    }

    @Test
    fun whatwg_ipv4_numbers() {
        assertEquals(HostClass.LOOPBACK, classOf("http://0177.0.0.1/"))
        assertEquals(HostClass.LOOPBACK, classOf("http://127.1/"))
        assertEquals(HostClass.LOOPBACK, classOf("http://127.0.0.1./"))
        assertEquals(HostClass.PRIVATE_LAN, classOf("http://0xA.0x/"))
        assertEquals(HostClass.PUBLIC, classOf("http://256.0.0.1/"), "an octet over 255 fails the parser")
        assertEquals(HostClass.PUBLIC, classOf("http://1.2.3.4.5/"), "five parts fail the parser")
        assertEquals(HostClass.PUBLIC, classOf("http://08.0.0.1/"), "8 is not an octal digit")
        assertEquals(HostClass.PUBLIC, classOf("http://4294967296/"), "past 32 bits")
        assertEquals(HostClass.PUBLIC, classOf("http://127..1/"), "an empty part")
    }

    @Test
    fun ipv6_literals() {
        assertEquals(HostClass.LOOPBACK, classOf("http://[0000:0000::0001]/"))
        assertEquals(HostClass.PRIVATE_LAN, classOf("http://[FD00::]/"))
        assertEquals(HostClass.PUBLIC, classOf("http://[1:2:3:4:5:6:7:8:9]/"), "nine groups")
        assertEquals(HostClass.PUBLIC, classOf("http://[1::2::3]/"), "two ::")
        assertEquals(HostClass.PUBLIC, classOf("http://[::ffff:127.0.0.01]/"), "a leading zero in the IPv4 tail")
        assertEquals(HostClass.PUBLIC, classOf("http://[::ffff:127.0.0.1:1]/"), "the IPv4 tail is not last")
        assertEquals(HostClass.PUBLIC, classOf("http://[12345::1]/"), "a five-digit group")
    }

    @Test
    fun hosts_as_okhttp_writes_them() {
        assertArrayEquals(intArrayOf(0, 0, 0, 0, 0, 0, 0, 1), (HostClassifier.parseUrlHost("::1") as ParsedHost.Ipv6).groups)
        assertEquals("192.168.1.5", (HostClassifier.parseUrlHost("192.168.1.5") as ParsedHost.Ipv4).dotted)
        assertEquals("nas.local", (HostClassifier.parseUrlHost("nas.local") as ParsedHost.Name).name)
        assertNull(HostClassifier.parseUrlHost("1:2"))
        assertNull(HostClassifier.parseUrlHost("300.1.1.1"))
        val mapped = HostClassifier.parseServerHost("http://[::ffff:c0a8:105]/") as ParsedHost.Ipv6
        assertEquals("192.168.1.5", mapped.mappedIpv4?.dotted)
        assertTrue(HostClassifier.classify(HostClassifier.parseUrlHost("xn--bcher-kva.local")!!) == HostClass.PUBLIC)
    }
}
