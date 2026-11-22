package dev.octave.session.http

// The largest answer body each class of call may cross (T3-16; docs/specs/T3-16.md, "The answer caps"). A larger
// body is unexpected-response, decided before it is parsed. The class comes from the authority and the method alone,
// so Kotlin holds no copy of the gateway's route list. Each cap is at least 40 times the largest recorded answer of
// its class.
internal object ResponseCaps {
    private const val MIB: Long = 1024L * 1024

    // The four pre-sign-in routes and the two sign-in posts.
    const val TOKENLESS: Long = 1 * MIB

    // A session's POST and DELETE.
    const val SESSION_WRITE: Long = 4 * MIB

    // A session's GET.
    const val SESSION_READ: Long = 8 * MIB

    // The logout's body is never read; its cap is the write cap should that change.
    fun of(authority: CallAuthority, method: String): Long = when (authority) {
        is CallAuthority.Tokenless -> TOKENLESS
        is CallAuthority.Session -> if (method == "GET") SESSION_READ else SESSION_WRITE
        is CallAuthority.Closing -> SESSION_WRITE
    }
}
