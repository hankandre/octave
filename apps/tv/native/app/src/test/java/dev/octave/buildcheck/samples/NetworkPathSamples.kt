package dev.octave.buildcheck.samples

import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request

// Compiled samples for NetworkPathsBytecodeTest. They sit under dev/octave/buildcheck/, which the real-source scan
// skips, and under /src/test/, which the source check and the T3-03 scans skip.

// K4: a second client.
class BuildsAClient {
    fun client(): OkHttpClient = OkHttpClient()
}

// K4: a client derived from one it was handed, with no client type written at the call.
class DerivesAClient {
    fun derive(handed: () -> OkHttpClient) = handed().newBuilder().build()
}

// K5: java.net's own connection.
class OpensAUrl {
    fun open(address: String) = java.net.URL(address).openConnection()
}

// K5: a URL's stream.
class ReadsAUrl {
    fun read(address: String) = java.net.URL(address).openStream()
}

// K8 (and K4): a network interceptor on a builder.
class AddsANetworkInterceptor {
    fun add(builder: OkHttpClient.Builder) = builder.addNetworkInterceptor { chain -> chain.proceed(chain.request()) }
}

// Clean: a request sent through a call factory, and a request copied with newBuilder().
class SendsThroughACallFactory {
    fun send(factory: Call.Factory, request: Request): Call = factory.newCall(request.newBuilder().build())
}

// Clean: a default-argument bridge (name$default) called from another class.
class CallsADefault {
    fun call() = withDefault()
}

fun withDefault(count: Int = 1): Int = count
