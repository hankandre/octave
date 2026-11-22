package dev.octave.session.http

import okhttp3.Interceptor
import okhttp3.Response

// Who a call is made for, carried as a private request tag.
// - Session names a session; the header is the registry's.
// - Tokenless carries a server address and the tokenless header (Token="") for the six calls decision 0005 allows
//   before sign-in: the four PRE_SIGN_IN_ROUTES and the two sign-in posts (T3-05).
// - Closing carries a session's entry after the registry removed it, for the one logout call (T3-05).
internal sealed class CallAuthority {
    class Session(val id: SessionId) : CallAuthority() {
        override fun toString(): String = "CallAuthority.Session([redacted])"
    }

    class Tokenless(val address: ServerAddress, val headerValue: String) : CallAuthority() {
        override fun toString(): String = "CallAuthority.Tokenless([redacted])"
    }

    class Closing(val entry: SessionEntry) : CallAuthority() {
        override fun toString(): String = "CallAuthority.Closing([redacted])"
    }
}

// The one application interceptor. It refuses by RequestPolicy before anything is sent, adds the session's header
// to a copy of the request, refuses any 3xx answer, and returns an answer that does not carry the header: the
// caller's own request, with no networkResponse and no priorResponse.
internal object SessionInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val authority = request.tag(CallAuthority::class.java)
        val headerValue = when (authority) {
            is CallAuthority.Session -> {
                val entry = SessionRegistry.entry(authority.id)
                RequestPolicy.check(entry, request)?.let { throw OctaveHttpException(it) }
                entry!!.authorization.headerValue()
            }
            is CallAuthority.Tokenless -> {
                RequestPolicy.checkTokenless(authority.address, request)?.let { throw OctaveHttpException(it) }
                authority.headerValue
            }
            is CallAuthority.Closing -> {
                RequestPolicy.checkClosing(authority.entry, request)?.let { throw OctaveHttpException(it) }
                authority.entry.authorization.headerValue()
            }
            null -> throw OctaveHttpException(HttpRefusal.NO_SESSION)
        }
        val authorised = request.newBuilder().header("Authorization", headerValue).build()
        // The resolved-address rule reads the call's scheme from this mark when OkHttp asks it for addresses (T3-20).
        val response = ResolvedAddressRule.proceeding(request.url) { chain.proceed(authorised) }
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
