package dev.octave.session

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The native session module (decision 0005). It has a name and no JavaScript surface: the session surface
// (signIn, request, restoreSessions, endSession, sessionEnded) arrives with T3-05 and T4-05, each under a decision
// record. Kotlin callers use dev.octave.session.http.OctaveHttp.
class OctaveSessionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OctaveSession")
  }
}
