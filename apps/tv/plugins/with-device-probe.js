// Adds the device probes' build to the generated Gradle project (T3-15). It appends, once, to android/build.gradle the
// task `octaveDeviceProbeApk`, which builds the debug test APK (assembleDebugAndroidTest) of every project under the
// repository's modules/ that has an src/androidTest directory, the same project lookup as `octaveNativeTest`.
// scripts/tv-build.mjs runs it for an e2e build; the probe APK never ships.
const { withProjectBuildGradle } = require("expo/config-plugins");

const ROOT_MARKER = "// @octave-begin octave-device-probe";

// android/ is apps/tv/android, three levels below the repository.
const ROOT_BLOCK = `
${ROOT_MARKER} (apps/tv/plugins/with-device-probe.js)
tasks.register("octaveDeviceProbeApk") {
    group = "build"
    description = "Builds the device probe test APK of every project under the repository's modules/ that has one."
    def modulesDir = file("../../../modules").canonicalPath + File.separator
    dependsOn(provider {
        subprojects
            .findAll { it.projectDir.canonicalPath.startsWith(modulesDir) && new File(it.projectDir, "src/androidTest").isDirectory() }
            .collect { it.tasks.findByName("assembleDebugAndroidTest") }
            .findAll { it != null }
    })
}
// @octave-end octave-device-probe
`;

const addProbeTask = (contents) => (contents.includes(ROOT_MARKER) ? contents : `${contents.replace(/\n*$/, "\n")}${ROOT_BLOCK}`);

function withDeviceProbe(config) {
  return withProjectBuildGradle(config, (c) => {
    if (c.modResults.language !== "groovy") throw new Error("with-device-probe: android/build.gradle is not Groovy");
    c.modResults.contents = addProbeTask(c.modResults.contents);
    return c;
  });
}

module.exports = withDeviceProbe;
module.exports.addProbeTask = addProbeTask;
