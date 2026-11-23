package dev.octave.session

import android.content.pm.ApplicationInfo
import dev.octave.session.http.DevelopmentServers

// The one input that makes a build a development build (T3-33; docs/specs/T3-33.md, "The rule"): the app's
// ApplicationInfo.FLAG_DEBUGGABLE. The module's own BuildConfig.DEBUG is not it: a debugOptimized app links the
// module's release variant. With no flags to read (no React context) the build counts as a development build: it fails
// closed. BuildServersTest checks each case and that OctaveSessionModule decides only through here.
internal object BuildServers {
    fun of(applicationFlags: Int?, allowlist: String): DevelopmentServers {
        val debuggable = applicationFlags == null || (applicationFlags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        return DevelopmentServers.forBuild(debuggable, allowlist)
    }
}
