package dev.octave.session

import android.os.Build
import dev.octave.session.http.ClientIdentity
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

  private val transport: SessionTransport by lazy { SessionTransport(ClientIdentity.of(Build.MODEL, versionName())) }

  override fun definition() = ModuleDefinition {
    Name("OctaveSession")

    AsyncFunction("signIn") { args: Map<String, Any?>, promise: Promise -> run(promise) { transport.signIn(args) } }

    AsyncFunction("request") { args: Map<String, Any?>, promise: Promise -> run(promise) { transport.request(args) } }

    AsyncFunction("endSession") { args: Map<String, Any?>, promise: Promise -> run(promise) { transport.endSession(args) } }

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

  private fun versionName(): String? {
    val context = appContext.reactContext ?: return null
    return try {
      context.packageManager.getPackageInfo(context.packageName, 0).versionName
    } catch (_: Exception) {
      null
    }
  }
}
