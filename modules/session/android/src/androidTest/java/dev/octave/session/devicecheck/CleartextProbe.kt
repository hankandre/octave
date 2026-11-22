package dev.octave.session.devicecheck

import android.app.Activity
import android.app.Instrumentation
import android.os.Bundle
import android.security.NetworkSecurityPolicy
import dev.octave.session.http.HttpRefusal
import dev.octave.session.http.MediaBrowserAuthorization
import dev.octave.session.http.MediaBrowserHeader
import dev.octave.session.http.OctaveHttp
import dev.octave.session.http.OctaveHttpException
import dev.octave.session.http.SessionRegistry
import okhttp3.Request
import org.json.JSONObject

// T3-15's device probe (docs/specs/T3-15.md, "The device probe"). It runs in the module's test APK, whose network
// security configuration comes from the module's own manifest, the declaration the release app merges. It sends plain
// HTTP through the one client to a private-LAN and a loopback address of the host's test server, and opens a session
// for every public vector of host-classes.json, each of which must be refused before a request exists. It reports
// fixed words and counts only, never an address, a host, a header or an exception message, and logs nothing.
// Run by scripts/tv-cleartext.mjs: am instrument -w -e hostPort <port> <test package>/<this class>.
class CleartextProbe : Instrumentation() {
    private var hostPort: Int? = null

    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        hostPort = arguments?.getString("hostPort")?.toIntOrNull()?.takeIf { it in 1..65535 }
        start()
    }

    override fun onStart() {
        super.onStart()
        val results = Bundle()
        section(results, "policy") { if (NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted) "permitted" else "refused" }
        section(results, "target-sdk") { context.applicationInfo.targetSdkVersion.toString() }
        val port = hostPort
        if (port == null) {
            results.putString("private-lan", "failed-NoPort")
            results.putString("loopback", "failed-NoPort")
        } else {
            section(results, "private-lan") { plainGet("http://10.0.2.2:$port", "/octave-probe/private-lan") }
            section(results, "loopback") { plainGet("http://127.0.0.1:$port", "/octave-probe/loopback") }
        }
        publicVectors(results)
        section(results, "https-open") {
            val session = SessionRegistry.open("https://media.example", canary())
            SessionRegistry.close(session)
            "ok"
        }
        results.putString("done", "yes")
        finish(Activity.RESULT_OK, results)
    }

    // One GET through the one client for a session opened at base. Returns the status, or a fixed failure word.
    private fun plainGet(base: String, path: String): String {
        val session = try {
            SessionRegistry.open(base, canary())
        } catch (refused: OctaveHttpException) {
            return "refused-${refused.refusal.code}"
        }
        try {
            val request = Request.Builder().url("$base$path").get().build()
            OctaveHttp.callFactory(session).newCall(request).execute().use { response -> return response.code.toString() }
        } catch (refused: OctaveHttpException) {
            return "refused-${refused.refusal.code}"
        } finally {
            SessionRegistry.close(session)
        }
    }

    private fun publicVectors(results: Bundle) {
        try {
            val text = context.assets.open("host-classes.json").bufferedReader().use { it.readText() }
            val vectors = JSONObject(text).getJSONArray("vectors")
            var total = 0
            var refused = 0
            var other = 0
            for (index in 0 until vectors.length()) {
                val vector = vectors.getJSONObject(index)
                if (vector.getString("class") != "public") continue
                total += 1
                try {
                    SessionRegistry.close(SessionRegistry.open(vector.getString("url"), canary()))
                    other += 1
                } catch (error: OctaveHttpException) {
                    if (error.refusal == HttpRefusal.PUBLIC_HTTP) refused += 1 else other += 1
                } catch (error: Exception) {
                    other += 1
                }
            }
            results.putString("public-total", total.toString())
            results.putString("public-refused", refused.toString())
            results.putString("public-other", other.toString())
        } catch (error: Exception) {
            results.putString("public-total", "failed-${error.javaClass.simpleName}")
        }
    }

    // Each section writes its own key, so one failure does not hide the others; only the class name of an error.
    private fun section(results: Bundle, key: String, run: () -> String) {
        val value = try {
            run()
        } catch (error: Exception) {
            "failed-${error.javaClass.simpleName}"
        }
        results.putString(key, value)
    }

    // A made-up header in the builder's shape; scripts/tv-cleartext.mjs holds the same built value as CANARY_HEADER.
    private fun canary(): MediaBrowserAuthorization =
        MediaBrowserAuthorization.parse(MediaBrowserHeader.build("OctaveProbe", "Emulator", "cleartext-probe", "0.0.0", "canary0123456789"))
            ?: throw IllegalStateException("canary")
}
