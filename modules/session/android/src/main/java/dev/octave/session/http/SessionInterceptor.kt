package dev.octave.session.http

import okhttp3.Interceptor
import okhttp3.Response

// Who a call is made for, carried as a private request tag. It names the session and never holds the header.
// T3-05 adds the pre-sign-in authority as a second case.
internal sealed class CallAuthority {
    class Session(val id: SessionId) : CallAuthority() {
        override fun toString(): String = "CallAuthority.Session([redacted])"
    }
}

// The one application interceptor. It refuses by RequestPolicy before anything is sent, adds the session's header
// to a copy of the request, refuses any 3xx answer, and returns an answer that does not carry the header: the
// caller's own request, with no networkResponse and no priorResponse.
internal object SessionInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val authority = request.tag(CallAuthority::class.java)
        val entry = when (authority) {
            is CallAuthority.Session -> SessionRegistry.entry(authority.id)
            null -> null
        }
        RequestPolicy.check(entry, request)?.let { throw OctaveHttpException(it) }
        val authorised = request.newBuilder().header("Authorization", entry!!.authorization.headerValue()).build()
        val response = chain.proceed(authorised)
        if (response.code in 300..399) {
            response.close()
            throw OctaveHttpException(HttpRefusal.REDIRECT)
        }
        return response.newBuilder()
            .request(request)
            .networkResponse(null)
            .priorResponse(null)
            .build()
    }
}
