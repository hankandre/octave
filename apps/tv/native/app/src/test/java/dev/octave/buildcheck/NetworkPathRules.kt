package dev.octave.buildcheck

// T3-04's rules applied to one compiled class by type (docs/specs/T3-04.md, "The JVM test"). The ids are the source
// rules' (K1 to K10 in scripts/check-network-paths.mjs), so a failure here names the same alternative there.
data class NetworkViolation(val rule: String, val className: String, val what: String) {
    override fun toString(): String = "$rule: $className refers to $what"
}

object NetworkPathRules {
    val RULE_IDS = listOf("K1", "K2", "K3", "K4", "K5", "K6", "K7", "K8", "K9", "K10")

    private const val ONE_CLIENT = "okhttp3/OkHttpClient"
    private val ONE_CLIENT_CLASSES = setOf("dev/octave/session/http/OctaveHttp", "dev/octave/session/http/SessionCallFactory")
    private const val SESSION = "dev/octave/session/"

    private val K1 = listOf(
        "androidx/media3/datasource/DefaultHttpDataSource",
        "androidx/media3/datasource/HttpEngineDataSource",
        "androidx/media3/datasource/UdpDataSource",
        "androidx/media3/datasource/rtmp/RtmpDataSource",
        "androidx/media3/exoplayer/rtsp/RtspMediaSource",
    )
    private val K2 = listOf("androidx/media3/datasource/DefaultDataSource")
    private val K5 = listOf("java/net/HttpURLConnection", "javax/net/ssl/HttpsURLConnection", "java/net/URLConnection")
    private val K5_URL_METHODS = setOf("openConnection", "openStream", "getContent")
    private const val URL_TYPE = "Ljava/net/URL;"
    // Other HTTP stacks, and players and image loaders that fetch a URL themselves, by class name or package. Each is
    // matched at the start of a name, after `L` in a descriptor, or after `/` (a dotted reflective name read as slashed).
    private val K4_STACKS = listOf(
        "java/net/http/",
        "org/chromium/net/",
        "com/android/volley/",
        "android/app/DownloadManager",
        "android/media/MediaPlayer",
        "android/widget/VideoView",
        "coil/",
        "coil3/",
        "com/bumptech/glide/",
        "com/squareup/picasso/",
    )
    private val K7 = listOf(
        "com/facebook/react/modules/network/OkHttpClientProvider",
        "com/facebook/react/modules/network/OkHttpClientFactory",
        "com/facebook/react/modules/network/CustomClientBuilder",
        "com/facebook/react/modules/network/NetworkingModule",
        "com/facebook/react/modules/websocket/WebSocketModule",
        "com/facebook/react/modules/fresco/FrescoModule",
        "com/facebook/react/modules/fresco/ReactOkHttpNetworkFetcher",
        "com/facebook/react/devsupport/inspector/DevSupportHttpClient",
        "com/swmansion/worklets/ScriptBufferWrapper",
        "expo/modules/fetch/",
        "expo/modules/filesystem/",
        "expo/modules/asset/",
        "expo/modules/logbox/",
        "expo/modules/webview/",
        "com/swmansion/worklets/networking/",
        // The other classes of the dex check's APK_NETWORK_ENTRY_POINTS rows (T3-19 decision log 27): the dex check
        // cannot attribute a reference to a class R8 merged, so the refusal of each listed class sits here, before R8.
        // NetworkPathRulesCoverageTest fails when a row class or hook is missing.
        "com/facebook/react/common/network/OkHttpCallUtil",
        "com/facebook/react/modules/network/RequestBodyUtil",
        "com/facebook/imagepipeline/backends/okhttp3/OkHttpNetworkFetcher",
        "com/facebook/imagepipeline/backends/okhttp3/OkHttpImagePipelineConfigFactory",
        "com/facebook/imagepipeline/producers/HttpUrlConnectionNetworkFetcher",
        "com/facebook/react/devsupport/inspector/InspectorNetworkHelper",
        "com/facebook/react/devsupport/CxxInspectorPackagerConnection\$DelegateImpl",
        "com/facebook/react/devsupport/DevServerHelper",
        "com/facebook/react/devsupport/PackagerStatusCheck",
        "com/facebook/react/devsupport/BundleDownloader",
        "com/facebook/react/runtime/ReactHostImpl",
        "kotlin/reflect/jvm/internal/impl/serialization/deserialization/builtins/BuiltInsResourceLoader",
    )
    private val K8 = listOf("expo/modules/kotlin/devtools/", "okhttp3/logging/HttpLoggingInterceptor")
    private val K9 = listOf("android/webkit/WebView")

    private const val MEDIA_SOURCE_FACTORY = "androidx/media3/exoplayer/source/DefaultMediaSourceFactory"
    private const val DATA_SOURCE_FACTORY = "Landroidx/media3/datasource/DataSource\$Factory;"
    private const val PLAYER_BUILDER = "androidx/media3/exoplayer/ExoPlayer\$Builder"
    private const val MEDIA_SOURCES = "Landroidx/media3/exoplayer/source/MediaSource\$Factory;"

    // A Kotlin `internal` member as another module sees it: `getClient$octave_session_debug`. A public function's
    // default-argument bridge (`name$default`) is not one.
    private fun isMangledInternal(name: String): Boolean {
        val mark = name.indexOf('$')
        return mark > 0 && !name.endsWith("\$default")
    }

    fun check(refs: ClassRefs): List<NetworkViolation> {
        val found = mutableListOf<NetworkViolation>()
        // Every UTF-8 constant, with a dotted name (a reflective string) read as a slashed one.
        val names = refs.utf8.map { it.replace('.', '/') }
        fun named(rule: String, prefixes: List<String>) {
            for (prefix in prefixes) {
                if (names.any { it.contains(prefix) }) found += NetworkViolation(rule, refs.name, prefix)
            }
        }
        named("K1", K1)
        named("K2", K2)
        named("K5", K5)
        named("K7", K7)
        named("K8", K8)
        named("K9", K9)
        for (prefix in K4_STACKS) {
            if (names.any { it.startsWith(prefix) || it.contains("L$prefix") }) found += NetworkViolation("K4", refs.name, prefix)
        }

        if (refs.name !in ONE_CLIENT_CLASSES && names.any { it.contains(ONE_CLIENT) }) {
            found += NetworkViolation("K4", refs.name, ONE_CLIENT)
        }
        for (member in refs.members) {
            if (member.owner == "java/net/URL" && (member.name in K5_URL_METHODS || member.name == "<init>")) {
                found += NetworkViolation("K5", refs.name, "java/net/URL.${member.name}")
            }
            // A member that takes a URL opens it for the caller, as the standard library's `URL.readText()` does
            // through `TextStreamsKt.readBytes(URL)`.
            if (member.owner != "java/net/URL" && URL_TYPE in member.descriptor.substringBefore(')')) {
                found += NetworkViolation("K5", refs.name, "${member.owner}.${member.name}, which takes a java.net.URL")
            }
            if (member.owner == "okhttp3/OkHttpClient\$Builder" && member.name == "addNetworkInterceptor") {
                found += NetworkViolation("K8", refs.name, "a network interceptor")
            }
            if (member.owner.startsWith(SESSION) && !refs.name.startsWith(SESSION) && isMangledInternal(member.name)) {
                found += NetworkViolation("K10", refs.name, "${member.owner}.${member.name}")
            }
        }
        val statesDataSource = refs.members.any { it.owner == MEDIA_SOURCE_FACTORY && it.name == "setDataSourceFactory" }
        if (!statesDataSource && refs.members.any { it.owner == MEDIA_SOURCE_FACTORY && it.name == "<init>" && DATA_SOURCE_FACTORY !in it.descriptor }) {
            found += NetworkViolation("K3", refs.name, "DefaultMediaSourceFactory with no stated data source")
        }
        val statesMediaSources = refs.members.any { it.owner == PLAYER_BUILDER && it.name == "setMediaSourceFactory" }
        if (!statesMediaSources && refs.members.any { it.owner == PLAYER_BUILDER && it.name == "<init>" && MEDIA_SOURCES !in it.descriptor }) {
            found += NetworkViolation("K6", refs.name, "ExoPlayer.Builder with no stated media source factory")
        }
        return found
    }
}
