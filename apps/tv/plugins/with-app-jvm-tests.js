// Adds Octave's JVM tests to the generated Gradle project (T3-01 item 5). It appends, once, to android/app/build.gradle:
// the test sources under apps/tv/native/app/src/test/java, JUnit Jupiter through the JUnit BOM, the JUnit Platform on
// the unit-test tasks, and two system properties the tests read; and to android/build.gradle the task
// `octaveNativeTest`, which runs :app's unit tests and those of every project under the repository's modules/, with an
// optional test filter (-Poctave.tests=<filter>). AGP 9
// creates unit-test tasks only for the tested build type, debug, so these are the testDebugUnitTest tasks; the tests
// read defaultConfig, which both build types share.
const { withAppBuildGradle, withProjectBuildGradle } = require("expo/config-plugins");

const JUNIT_BOM = "org.junit:junit-bom:6.1.3";
const APP_MARKER = "// @octave-begin app-jvm-tests";
const ROOT_MARKER = "// @octave-begin octave-native-test";

// Paths are relative to the Gradle project: android/app is apps/tv/android/app, four levels below the repository.
const APP_BLOCK = `
${APP_MARKER} (apps/tv/plugins/with-app-jvm-tests.js)
android {
    sourceSets {
        test.java.srcDir(file("../../native/app/src/test/java"))
    }
    testOptions {
        unitTests.all {
            useJUnitPlatform()
            systemProperty "octave.repoRoot", file("../../../..").canonicalPath
            systemProperty "octave.applicationId", android.defaultConfig.applicationId
        }
    }
}
dependencies {
    testImplementation platform("${JUNIT_BOM}")
    testImplementation "org.junit.jupiter:junit-jupiter"
    testRuntimeOnly "org.junit.platform:junit-platform-launcher"
}
// @octave-end app-jvm-tests
`;

// android/ is apps/tv/android, three levels below the repository.
const ROOT_BLOCK = `
${ROOT_MARKER} (apps/tv/plugins/with-app-jvm-tests.js)
tasks.register("octaveNativeTest") {
    group = "verification"
    description = "Runs the JVM tests of :app and of every project under the repository's modules/."
    def modulesDir = file("../../../modules").canonicalPath + File.separator
    dependsOn(":app:testDebugUnitTest")
    dependsOn(provider {
        subprojects
            .findAll { it.projectDir.canonicalPath.startsWith(modulesDir) }
            .collect { it.tasks.findByName("testDebugUnitTest") ?: it.tasks.findByName("test") }
            .findAll { it != null }
    })
}
// scripts/tv-native-test-only.mjs passes -Poctave.tests=<filter> to run one test class; without it nothing changes.
if (rootProject.hasProperty("octave.tests")) {
    def octaveTests = rootProject.property("octave.tests").toString()
    allprojects {
        tasks.withType(Test).configureEach {
            filter.includeTestsMatching(octaveTests)
            filter.failOnNoMatchingTests = false
        }
    }
}
// @octave-end octave-native-test
`;

function appendOnce(contents, marker, block) {
  return contents.includes(marker) ? contents : `${contents.replace(/\n*$/, "\n")}${block}`;
}

const addAppTests = (contents) => appendOnce(contents, APP_MARKER, APP_BLOCK);
const addRootTask = (contents) => appendOnce(contents, ROOT_MARKER, ROOT_BLOCK);

function withAppJvmTests(config) {
  config = withAppBuildGradle(config, (c) => {
    if (c.modResults.language !== "groovy") throw new Error("with-app-jvm-tests: android/app/build.gradle is not Groovy");
    c.modResults.contents = addAppTests(c.modResults.contents);
    return c;
  });
  return withProjectBuildGradle(config, (c) => {
    if (c.modResults.language !== "groovy") throw new Error("with-app-jvm-tests: android/build.gradle is not Groovy");
    c.modResults.contents = addRootTask(c.modResults.contents);
    return c;
  });
}

module.exports = withAppJvmTests;
module.exports.addAppTests = addAppTests;
module.exports.addRootTask = addRootTask;
module.exports.JUNIT_BOM = JUNIT_BOM;
