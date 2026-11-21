package dev.octave.session.http

// Why the one client refused a call or a session. T3-05 maps these onto the core's transport error codes.
enum class HttpRefusal(val code: String) {
    NO_SESSION("no-session"),
    OTHER_ORIGIN("other-origin"),
    REDIRECT("redirect"),
    CREDENTIAL_URL("credential-url"),
    PUBLIC_HTTP("public-http"),
    INVALID_ADDRESS("invalid-address"),
    HEADER_NOT_ALLOWED("header-not-allowed"),
}

// The message is the code. It never holds a URL, a host, a header or a token, and it has no cause.
class OctaveHttpException(val refusal: HttpRefusal) : java.io.IOException(refusal.code)
