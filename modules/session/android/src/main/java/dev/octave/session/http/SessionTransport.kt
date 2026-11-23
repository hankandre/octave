package dev.octave.session.http

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.ResponseBody
import java.io.IOException
import java.io.InterruptedIOException
import java.util.concurrent.TimeUnit

// The core's Transport port in Kotlin (decision 0005, amendment T3-05; docs/specs/T3-05.md, "The native seam"). Three
// blocking functions, each from one plain argument map to one plain result map; OctaveSessionModule calls them off
// Expo's modules queue. Every outcome is a value: { error: <one of the core's seven codes> } and, for "status", the
// status. No result holds a token, a header, a URL or an exception message, and nothing here logs.
//
//   signIn     { server, deviceId, kind: "password", username, password, timeoutMs }
//              { server, deviceId, kind: "quick-connect", secret, timeoutMs }
//              -> { session, userId, userName?, serverId? } or { error, status? }
//   request    { session } or { server, deviceId }, plus method, path, query ([[name, value], ...]), body (JSON text,
//              or absent), timeoutMs -> { status, body } (body JSON text or null) or { error }
//   endSession { session, timeoutMs } -> {} or { error, status? }
//
// `servers` is the development-build rule (T3-33): signIn and every call before sign-in ask it after the address is
// parsed and before anything is sent. A session's calls and endSession need not: a session exists only because signIn
// passed the rule in this process.
internal class SessionTransport(private val identity: ClientIdentity, private val servers: DevelopmentServers) {
    fun signIn(args: Map<String, Any?>): Map<String, Any?> = outcome {
        val kind = args["kind"]
        val (path, body) = when (kind) {
            "password" -> {
                allowOnly(args, SIGN_IN_PASSWORD_KEYS)
                "/Users/AuthenticateByName" to buildJsonObject {
                    put("Username", string(args, "username"))
                    put("Pw", string(args, "password"))
                }
            }
            "quick-connect" -> {
                allowOnly(args, SIGN_IN_QUICK_CONNECT_KEYS)
                "/Users/AuthenticateWithQuickConnect" to buildJsonObject { put("Secret", string(args, "secret")) }
            }
            else -> throw Refused()
        }
        val server = string(args, "server")
        val deviceId = string(args, "deviceId")
        val timeoutMs = timeoutMs(args)
        val address = ServerAddress.parse(server)
        servers.check(address)
        val authority = CallAuthority.Tokenless(address, tokenlessHeader(deviceId))
        val request = buildRequest(address, "POST", path, null, body.toString())
        val answer = send(request, authority, timeoutMs, resend = false)
        if (answer.status !in 200..299) return@outcome statusError(answer.status)
        val data = answer.json as? JsonObject ?: throw UnusableAnswer()
        val token = nonEmptyString(data["AccessToken"]) ?: throw UnusableAnswer()
        val user = data["User"] as? JsonObject ?: throw UnusableAnswer()
        val userId = nonEmptyString(user["Id"]) ?: throw UnusableAnswer()
        val header = try {
            MediaBrowserHeader.build(ClientIdentity.CLIENT, identity.device, deviceId, identity.version, token)
        } catch (_: IllegalArgumentException) {
            throw UnusableAnswer()
        }
        val authorization = MediaBrowserAuthorization.parse(header) ?: throw UnusableAnswer()
        val session = SessionRegistry.open(server, authorization)
        val forms = TokenStrip.forms(token)
        val result = mutableMapOf<String, Any?>("session" to session.value, "userId" to TokenStrip.clean(userId, forms))
        string(user["Name"])?.let { result["userName"] = TokenStrip.clean(it, forms) }
        string(data["ServerId"])?.let { result["serverId"] = TokenStrip.clean(it, forms) }
        result
    }

    fun request(args: Map<String, Any?>): Map<String, Any?> = outcome {
        val method = args["method"] as? String ?: throw Refused()
        if (method !in METHODS) throw Refused()
        val path = string(args, "path")
        if (!RequestPath.isSafe(path)) throw Refused()
        val timeoutMs = timeoutMs(args)
        val pairs = queryPairs(args["query"])
        if (pairs.any { (name, _) -> HostClassifier.jsTrim(name).lowercase() in CredentialQuery.NAMES }) throw Refused()
        val body = args["body"]?.let { it as? String ?: throw Refused() }
        if (body != null && runCatching { Json.parseToJsonElement(body) }.isFailure) throw Refused()

        val address: ServerAddress
        val authority: CallAuthority
        val forms: List<String>
        if (args["session"] != null) {
            allowOnly(args, SESSION_REQUEST_KEYS)
            val session = SessionId.parse(string(args, "session")) ?: throw Refused()
            val entry = SessionRegistry.entry(session) ?: throw Refused()
            address = entry.address
            authority = CallAuthority.Session(session)
            forms = TokenStrip.forms(entry.authorization)
        } else {
            allowOnly(args, TOKENLESS_REQUEST_KEYS)
            if (RequestPolicy.PRE_SIGN_IN_ROUTES.none { it == method to path }) throw Refused()
            address = ServerAddress.parse(string(args, "server"))
            servers.check(address)
            authority = CallAuthority.Tokenless(address, tokenlessHeader(string(args, "deviceId")))
            forms = emptyList()
        }
        val request = buildRequest(address, method, path, QueryEncoding.encode(pairs), body)
        val answer = send(request, authority, timeoutMs, resend = method == "GET")
        if (answer.status !in 200..299 && answer.status !in 400..599) throw UnusableAnswer()
        val stripped = answer.json?.let { TokenStrip.strip(it, forms) }
        mapOf("status" to answer.status, "body" to stripped?.toString())
    }

    fun endSession(args: Map<String, Any?>): Map<String, Any?> = outcome {
        allowOnly(args, END_SESSION_KEYS)
        val session = SessionId.parse(string(args, "session")) ?: throw Refused()
        val timeoutMs = timeoutMs(args)
        // The entry goes first (decision 0005): the logout below can fail and the session is gone either way.
        val entry = SessionRegistry.take(session) ?: return@outcome emptyMap()
        val request = buildRequest(entry.address, "POST", "/Sessions/Logout", null, null)
        val status = send(request, CallAuthority.Closing(entry), timeoutMs, resend = false, readBody = false).status
        if (status !in 200..299) statusError(status) else emptyMap()
    }

    private fun tokenlessHeader(deviceId: String): String = try {
        MediaBrowserHeader.buildTokenless(ClientIdentity.CLIENT, identity.device, deviceId, identity.version)
    } catch (_: IllegalArgumentException) {
        throw Refused()
    }

    private fun buildRequest(address: ServerAddress, method: String, path: String, query: String?, body: String?): Request {
        if (method == "GET" && body != null) throw Refused()
        val requestBody: RequestBody? = when {
            body != null -> body.toRequestBody(JSON)
            method == "GET" -> null
            else -> ByteArray(0).toRequestBody(null)
        }
        return try {
            Request.Builder()
                .url(address.url(path, query))
                .header("Accept", "application/json")
                .method(method, requestBody)
                .build()
        } catch (_: IllegalArgumentException) {
            throw Refused()
        }
    }

    private class Answer(val status: Int, val json: JsonElement?)

    // Sends inside one deadline. A GET whose first attempt failed before any answer, with an IOException that is not a
    // timeout or a refusal, is sent once more in what is left of the deadline (docs/specs/T3-05.md, "Retries").
    private fun send(request: Request, authority: CallAuthority, timeoutMs: Long, resend: Boolean, readBody: Boolean = true): Answer {
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
        var attempts = if (resend) 2 else 1
        while (true) {
            attempts -= 1
            val left = deadline - System.nanoTime()
            if (left <= 0) throw InterruptedIOException()
            val call = OctaveHttp.newCall(request, authority)
            call.timeout().timeout(left, TimeUnit.NANOSECONDS)
            val response = try {
                call.execute()
            } catch (error: IOException) {
                if (call.isCanceled() || error is InterruptedIOException) throw InterruptedIOException()
                if (error is OctaveHttpException || attempts == 0) throw error
                continue
            }
            return response.use {
                if (!readBody) return@use Answer(it.code, null)
                Answer(it.code, parse(readLimited(call, it.body, ResponseCaps.of(authority, request.method))))
            }
        }
    }

    // At most `cap` bytes, else UnusableAnswer: at once when the answer declares a larger length, otherwise after
    // reading cap + 1 bytes. A 4xx or 5xx answer has the same cap.
    private fun readLimited(call: Call, body: ResponseBody, cap: Long): ByteArray = try {
        if (body.contentLength() > cap) throw UnusableAnswer()
        val source = body.source()
        if (source.request(cap + 1)) throw UnusableAnswer()
        source.buffer.readByteArray()
    } catch (error: UnusableAnswer) {
        throw error
    } catch (error: IOException) {
        if (call.isCanceled() || error is InterruptedIOException) throw InterruptedIOException()
        throw UnusableAnswer()
    }

    // An empty or non-JSON body is null, so no HTML error page crosses. The tree reader takes an unquoted word as a
    // literal (it read `<html>oops</html>` as one), so every literal must also be true, false, null or a JSON number.
    // A text that begins with [ or { and nests deeper than JsonDepth.MAX (64) is UnusableAnswer before the parse, at
    // every status (docs/specs/T3-25.md): the reader recurses on arrays, so the bound is checked on the text.
    private fun parse(bytes: ByteArray): JsonElement? {
        if (bytes.isEmpty()) return null
        val text = String(bytes, Charsets.UTF_8)
        if (JsonDepth.exceeds(text)) throw UnusableAnswer()
        val element = try {
            Json.parseToJsonElement(text)
        } catch (_: Exception) {
            return null
        }
        return if (strictJson(element)) element else null
    }

    private fun strictJson(element: JsonElement): Boolean = when (element) {
        is JsonObject -> element.values.all { strictJson(it) }
        is JsonArray -> element.all { strictJson(it) }
        is JsonPrimitive -> element.isString || element.content in LITERALS || JSON_NUMBER.matches(element.content)
    }

    private class Refused : Exception()

    private inline fun outcome(block: () -> Map<String, Any?>): Map<String, Any?> = try {
        block()
    } catch (_: Refused) {
        mapOf("error" to TransportCodes.REFUSED)
    } catch (error: Throwable) {
        mapOf("error" to TransportCodes.of(error))
    }

    private fun statusError(status: Int): Map<String, Any?> = mapOf("error" to TransportCodes.STATUS, "status" to status)

    private fun allowOnly(args: Map<String, Any?>, keys: Set<String>) {
        // A key whose value is null counts as absent.
        if (!keys.containsAll(args.filterValues { it != null }.keys)) throw Refused()
    }

    private fun string(args: Map<String, Any?>, key: String): String = args[key] as? String ?: throw Refused()

    private fun string(element: JsonElement?): String? = (element as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun nonEmptyString(element: JsonElement?): String? = string(element)?.takeIf { it.isNotEmpty() }

    // A positive whole number of milliseconds; JavaScript numbers arrive as Double.
    private fun timeoutMs(args: Map<String, Any?>): Long {
        val value = (args["timeoutMs"] as? Number)?.toDouble() ?: throw Refused()
        if (!value.isFinite() || value <= 0 || value != Math.floor(value) || value > Int.MAX_VALUE) throw Refused()
        return value.toLong()
    }

    // Absent or a list of two-string lists.
    private fun queryPairs(value: Any?): List<Pair<String, String>> {
        if (value == null) return emptyList()
        val list = value as? List<*> ?: throw Refused()
        return list.map { pair ->
            val parts = pair as? List<*> ?: throw Refused()
            if (parts.size != 2) throw Refused()
            (parts[0] as? String ?: throw Refused()) to (parts[1] as? String ?: throw Refused())
        }
    }

    companion object {
        private val JSON = "application/json".toMediaType()
        private val LITERALS = setOf("true", "false", "null")
        private val JSON_NUMBER = Regex("""-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?""")
        private val METHODS = setOf("GET", "POST", "DELETE")

        private val SIGN_IN_PASSWORD_KEYS = setOf("server", "deviceId", "kind", "username", "password", "timeoutMs")
        private val SIGN_IN_QUICK_CONNECT_KEYS = setOf("server", "deviceId", "kind", "secret", "timeoutMs")
        private val SESSION_REQUEST_KEYS = setOf("session", "method", "path", "query", "body", "timeoutMs")
        private val TOKENLESS_REQUEST_KEYS = setOf("server", "deviceId", "method", "path", "query", "body", "timeoutMs")
        private val END_SESSION_KEYS = setOf("session", "timeoutMs")
    }
}
