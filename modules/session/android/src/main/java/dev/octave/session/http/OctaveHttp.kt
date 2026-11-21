package dev.octave.session.http

import okhttp3.Call
import okhttp3.CookieJar
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.Proxy
import java.util.concurrent.TimeUnit

// The one authenticated HTTP client of the app (AGENTS.md, Tokens and network). It is built once and never handed
// out: Kotlin callers send through callFactory(session). It adds the header only for the session's origin, follows
// no redirect, uses no proxy, stores no cookie, and refuses every other origin. Nothing derives a second client from
// it, and it is never registered with React Native, Expo or a WebView.
object OctaveHttp {
    // For the module's own tests; never public.
    internal val client: OkHttpClient = OkHttpClient.Builder()
        .followRedirects(false)
        .followSslRedirects(false)
        .proxy(Proxy.NO_PROXY)
        .socketFactory(DirectSocketFactory)
        .cookieJar(CookieJar.NO_COOKIES)
        .cache(null)
        .retryOnConnectionFailure(false)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .addInterceptor(SessionInterceptor)
        .build()

    fun callFactory(session: SessionId): Call.Factory = SessionCallFactory(session)
}

// Tags each request with the session it is made for; the interceptor reads the tag.
private class SessionCallFactory(private val session: SessionId) : Call.Factory {
    override fun newCall(request: Request): Call =
        OctaveHttp.client.newCall(request.newBuilder().tag(CallAuthority::class.java, CallAuthority.Session(session)).build())

    override fun toString(): String = "OctaveHttp.CallFactory([redacted])"
}
