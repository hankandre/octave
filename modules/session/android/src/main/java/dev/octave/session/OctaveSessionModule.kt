package dev.octave.session

import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Build
import dev.octave.session.http.ClientIdentity
import dev.octave.session.http.DevelopmentServers
import dev.octave.session.http.SessionTransport
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

// The native session module (decision 0005 and its T3-05 amendment): signIn, request and endSession, the three
// members the core's Transport port names. restoreSessions and sessionEnded are T4-05's. Each takes one map and
// resolves one map (SessionTransport); none rejects on purpose.
//
// Threading: a plain AsyncFunction body runs on Expo's modules queue, one thread shared by every Expo module. A
// blocking call there would hold every later call until its deadline, so each body only hands the call to this
// module's IO scope and returns; the coroutine resolves the promise.
class OctaveSessionModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  @Volatile
  private var built: SessionTransport? = null

  override fun definition() = ModuleDefinition {
    Name("OctaveSession")

    AsyncFunction("signIn") { args: Map<String, Any?>, promise: Promise -> run(promise) { transport().signIn(args) } }

    AsyncFunction("request") { args: Map<String, Any?>, promise: Promise -> run(promise) { transport().request(args) } }

    AsyncFunction("endSession") { args: Map<String, Any?>, promise: Promise -> run(promise) { transport().endSession(args) } }

    OnDestroy { scope.cancel() }
  }

  private fun run(promise: Promise, call: () -> Map<String, Any?>) {
    scope.launch {
      // SessionTransport catches everything itself; this is the last guard, and it carries a code only.
      val result = try {
        call()
      } catch (_: Throwable) {
        mapOf("error" to "network")
      }
      promise.resolve(result)
    }
  }

  // The transport, built once the React context exists. Without a context the app's debuggable flag cannot be read,
  // so that one call gets a transport that counts the build as a development build (T3-33, fails closed), and
  // nothing is kept: a later call with a context builds the real one.
  private fun transport(): SessionTransport {
    built?.let { return it }
    val context = appContext.reactContext
      ?: return SessionTransport(ClientIdentity.of(Build.MODEL, null), DevelopmentServers.forBuild(true, BuildConfig.OCTAVE_DEV_SERVERS))
    return synchronized(this) {
      built ?: run {
        val debuggable = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        val servers = DevelopmentServers.forBuild(debuggable, BuildConfig.OCTAVE_DEV_SERVERS)
        SessionTransport(ClientIdentity.of(Build.MODEL, versionName(context)), servers).also { built = it }
      }
    }
  }

  private fun versionName(context: Context): String? {
    return try {
      context.packageManager.getPackageInfo(context.packageName, 0).versionName
    } catch (_: Exception) {
      null
    }
  }
}
