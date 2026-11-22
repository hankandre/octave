package dev.octave.session.http

// The Client, Device and Version fields of the header (T3-05). Client is Octave, held equal to the core's APP_NAME by
// a JVM test. Device is the Android model name and Version the app's versionName, both read by OctaveSessionModule,
// since this package imports no Android class. The values go into the header only: never into a result, a log or a URL.
class ClientIdentity private constructor(val device: String, val version: String) {
    override fun toString(): String = "ClientIdentity([redacted])"

    companion object {
        const val CLIENT: String = "Octave"
        const val DEFAULT_DEVICE: String = "Android TV"
        const val DEFAULT_VERSION: String = "0.0.0"

        // A blank model is "Android TV"; a lone surrogate, which the header builder refuses, becomes U+FFFD.
        fun of(model: String?, versionName: String?): ClientIdentity =
            ClientIdentity(
                wellFormed(model?.trim().takeUnless { it.isNullOrEmpty() } ?: DEFAULT_DEVICE),
                wellFormed(versionName?.trim().takeUnless { it.isNullOrEmpty() } ?: DEFAULT_VERSION),
            )

        private fun wellFormed(text: String): String {
            val out = StringBuilder(text.length)
            var index = 0
            while (index < text.length) {
                val char = text[index]
                if (Character.isHighSurrogate(char) && index + 1 < text.length && Character.isLowSurrogate(text[index + 1])) {
                    out.append(char).append(text[index + 1])
                    index += 2
                } else {
                    out.append(if (Character.isSurrogate(char)) '�' else char)
                    index += 1
                }
            }
            return out.toString()
        }
    }
}
