package dev.octave.session.http

// Why the one client refused a call or a session. TransportCodes maps REDIRECT to redirect and every other one to
// refused (T3-05).
enum class HttpRefusal(val code: String) {
    NO_SESSION("no-session"),
    OTHER_ORIGIN("other-origin"),
    REDIRECT("redirect"),
    CREDENTIAL_URL("credential-url"),
    PUBLIC_HTTP("public-http"),
    INVALID_ADDRESS("invalid-address"),
    HEADER_NOT_ALLOWED("header-not-allowed"),

    // T3-05: a call without a session that is not one of the six tokenless calls, or a closing call that is not the logout.
    ROUTE_NOT_ALLOWED("route-not-allowed"),

    // T3-16: a session's call whose path is not its base path or under it.
    OUTSIDE_BASE_PATH("outside-base-path"),

    // T3-20: a plain-HTTP call to a name whose answer holds no loopback or private-LAN address (ResolvedAddressRule).
    RESOLVED_PUBLIC("resolved-public"),
}

// The message is the code. It never holds a URL, a host, a header or a token, and it has no cause.
class OctaveHttpException(val refusal: HttpRefusal) : java.io.IOException(refusal.code)
