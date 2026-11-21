package dev.octave.buildcheck

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.net.CookieHandler
import java.net.URI

// T3-03 moved every OkHttp artifact in the APK to 5.5.1. React Native wraps Android's cookie store in
// okhttp3.JavaNetCookieJar from okhttp-urlconnection; at 4.9.2 that class calls okhttp3.internal.Util, which OkHttp 5
// removed, so loading a stored cookie threw NoClassDefFoundError. This runs the jar on the app's own classpath.
class CookieJarLinkTest {
    private val handler = object : CookieHandler() {
        override fun get(uri: URI, requestHeaders: Map<String, List<String>>): Map<String, List<String>> =
            mapOf("Cookie" to listOf("a=1; b=2"))

        override fun put(uri: URI, responseHeaders: Map<String, List<String>>) = Unit
    }

    @Test
    fun reactNativesCookieJarLoadsAStoredCookieOnTheAppsOkHttp() {
        val jar = okhttp3.JavaNetCookieJar(handler)
        val cookies = jar.loadForRequest("http://192.168.1.5:8096/".toHttpUrl())
        assertEquals(listOf("a=1", "b=2"), cookies.map { "${it.name}=${it.value}" })
    }
}
