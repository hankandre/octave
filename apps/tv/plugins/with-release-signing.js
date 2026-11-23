// Signs the release build type with the owner's key and sets the application ID (T3-21). The template signs release
// with its public debug keystore; this plugin replaces that line with a signing config read at build time from the
// Java properties file that OCTAVE_SIGNING_PROPERTIES names, and fails any release packaging task when the file or one
// of its four keys is missing. The ID comes from the plugin option (apps/tv/app.config.ts, from the core's
// app-identity.ts); android.package stays the Kotlin package, so the namespace and the activity classes keep it.
const { withAppBuildGradle } = require("expo/config-plugins");

const SIGNING_VARIABLE = "OCTAVE_SIGNING_PROPERTIES";
const MARKER = "// @octave-begin release-signing";
const END_MARKER = "// @octave-end release-signing";
const DEBUG_LINE = /^[ \t]*signingConfig signingConfigs\.debug[ \t]*$/gm;

// Runs before `android {`: reads the properties file and collects what is missing, by name and never by value or path.
// The key names are built in pieces so that no password literal appears in the text.
const HELPER = `${MARKER} (apps/tv/plugins/with-release-signing.js)
def octaveSigningNames = ["storeFile", "keyAlias"] + ["store", "key"].collect { it + "Password" }
def octaveSigning = [:]
def octaveSigningMissing = []
def octaveInCheckout = { File f ->
    for (def d = f.canonicalFile.parentFile; d != null; d = d.parentFile) {
        if (new File(d, ".git").exists()) return true
    }
    return false
}
def octaveSigningVariable = System.getenv("${SIGNING_VARIABLE}")
if (!octaveSigningVariable) {
    octaveSigningMissing << "${SIGNING_VARIABLE} is not set"
} else if (!new File(octaveSigningVariable).isFile()) {
    octaveSigningMissing << "${SIGNING_VARIABLE} names a file that does not exist"
} else if (octaveInCheckout(new File(octaveSigningVariable))) {
    octaveSigningMissing << "${SIGNING_VARIABLE} names a file inside a checkout"
} else {
    def octaveSigningFile = new File(octaveSigningVariable).absoluteFile
    def octaveSigningProps = new Properties()
    octaveSigningFile.withInputStream { octaveSigningProps.load(it) }
    octaveSigningNames.each { name ->
        def value = octaveSigningProps.getProperty(name)
        if (value == null || value.trim().isEmpty()) octaveSigningMissing << "the properties file has no \${name}"
        else octaveSigning[name] = value.trim()
    }
    if (octaveSigningMissing.isEmpty()) {
        def octaveStore = new File(octaveSigning.storeFile)
        octaveSigning.storeFile = octaveStore.isAbsolute() ? octaveStore : new File(octaveSigningFile.parentFile, octaveSigning.storeFile)
        if (!octaveSigning.storeFile.isFile()) octaveSigningMissing << "storeFile does not exist"
        else if (octaveInCheckout(octaveSigning.storeFile)) octaveSigningMissing << "storeFile is inside a checkout"
    }
}
${END_MARKER}
`;

const CONFIG = `        octaveRelease {
            // Filled only when the key is complete; with none, release has no signing config and the guard below fails.
            if (octaveSigningMissing.isEmpty()) {
                storeFile octaveSigning.storeFile
                storePassword octaveSigning.storePassword
                keyAlias octaveSigning.keyAlias
                keyPassword octaveSigning.keyPassword
            }
        }
`;

const guardAndId = (applicationId) => `
${MARKER}-guard (apps/tv/plugins/with-release-signing.js)
android {
    defaultConfig {
        setApplicationId("${applicationId}")
    }
}
gradle.taskGraph.whenReady { graph ->
    def releaseTasks = ["packageRelease", "assembleRelease", "bundleRelease"]
    if (!octaveSigningMissing.isEmpty() && graph.allTasks.any { it.project == project && releaseTasks.contains(it.name) }) {
        throw new GradleException("ERROR tv build: no release signing key: " + octaveSigningMissing.join("; ") + ". Point ${SIGNING_VARIABLE} at your signing properties file (docs/commands.md).")
    }
}
${END_MARKER}-guard
`;

// The text of the braces that follow `start` in `text`, from the opening brace to its closing one.
function blockAfter(text, start) {
  const open = text.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    if (text[i] === "}") depth -= 1;
    if (depth === 0) return { open, close: i + 1 };
  }
  throw new Error("with-release-signing: unbalanced braces in android/app/build.gradle");
}

function addReleaseSigning(contents, { applicationId } = {}) {
  if (typeof applicationId !== "string" || !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(applicationId)) {
    throw new Error("with-release-signing: the plugin needs an applicationId option, in the form Android accepts");
  }
  if (contents.includes(MARKER)) return contents;
  const buildTypes = contents.indexOf("buildTypes");
  const release = buildTypes < 0 ? -1 : contents.indexOf("release", buildTypes);
  if (release < 0) throw new Error("with-release-signing: the template has no release build type (signingConfig line not found)");
  const { open, close } = blockAfter(contents, release);
  const block = contents.slice(open, close);
  const lines = block.match(DEBUG_LINE) ?? [];
  if (lines.length !== 1) {
    throw new Error(`with-release-signing: expected exactly one release "signingConfig signingConfigs.debug" line, found ${lines.length}`);
  }
  let out = contents.slice(0, open) + block.replace(DEBUG_LINE, (line) => line.replace("signingConfigs.debug", "signingConfigs.octaveRelease")) + contents.slice(close);

  const android = out.search(/^android \{$/m);
  const signingConfigs = out.indexOf("signingConfigs {");
  if (android < 0 || signingConfigs < 0) throw new Error("with-release-signing: the template has no android block or signingConfigs block");
  const afterBrace = out.indexOf("\n", signingConfigs) + 1;
  out = out.slice(0, afterBrace) + CONFIG + out.slice(afterBrace);
  out = out.slice(0, android) + HELPER + "\n" + out.slice(android);
  return `${out.replace(/\n*$/, "\n")}${guardAndId(applicationId)}`;
}

function withReleaseSigning(config, options) {
  return withAppBuildGradle(config, (c) => {
    if (c.modResults.language !== "groovy") throw new Error("with-release-signing: android/app/build.gradle is not Groovy");
    c.modResults.contents = addReleaseSigning(c.modResults.contents, options);
    return c;
  });
}

module.exports = withReleaseSigning;
module.exports.addReleaseSigning = addReleaseSigning;
module.exports.SIGNING_VARIABLE = SIGNING_VARIABLE;
