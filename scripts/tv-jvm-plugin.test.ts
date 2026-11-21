// @vitest-environment node
// T3-01 spec check note 2: apps/tv/plugins/with-app-jvm-tests.js appends its Gradle blocks once, without replacing
// template text, and puts them where Gradle reads them.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const plugin = require("../apps/tv/plugins/with-app-jvm-tests.js") as typeof import("../apps/tv/plugins/with-app-jvm-tests.js");

// The shape of the Expo SDK 58 template's android/app/build.gradle and android/build.gradle, shortened.
const APP_TEMPLATE = `apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"
apply plugin: "com.facebook.react"

android {
    namespace 'example.app'
    defaultConfig {
        applicationId 'example.app'
    }
}

dependencies {
    implementation("com.facebook.react:react-android")
}
`;
const ROOT_TEMPLATE = `buildscript {
  dependencies {
    classpath('com.android.tools.build:gradle')
  }
}

apply plugin: "expo-root-project"
apply plugin: "com.facebook.react.rootproject"
`;

describe("with-app-jvm-tests", () => {
  it("appends the app block after the template, keeping every template line", () => {
    const out = plugin.addAppTests(APP_TEMPLATE);
    expect(out.startsWith(APP_TEMPLATE)).toBe(true);
    const block = out.slice(APP_TEMPLATE.length);
    expect(block).toContain('test.java.srcDir(file("../../native/app/src/test/java"))');
    expect(block).toContain("useJUnitPlatform()");
    expect(block).toContain(`testImplementation platform("${plugin.JUNIT_BOM}")`);
    expect(block).toContain('testImplementation "org.junit.jupiter:junit-jupiter"');
    expect(block).toContain('testRuntimeOnly "org.junit.platform:junit-platform-launcher"');
    expect(block).toContain('systemProperty "octave.repoRoot", file("../../../..").canonicalPath');
    expect(block).toContain('systemProperty "octave.applicationId", android.defaultConfig.applicationId');
  });

  it("appends the app block once", () => {
    const once = plugin.addAppTests(APP_TEMPLATE);
    expect(plugin.addAppTests(once)).toBe(once);
  });

  it("appends the octaveNativeTest task to the root build file once", () => {
    const once = plugin.addRootTask(ROOT_TEMPLATE);
    expect(once.startsWith(ROOT_TEMPLATE)).toBe(true);
    expect(once).toContain('tasks.register("octaveNativeTest")');
    expect(once).toContain('dependsOn(":app:testDebugUnitTest")');
    expect(once).toContain('file("../../../modules")');
    expect(plugin.addRootTask(once)).toBe(once);
  });

  it("uses JUnit Jupiter through the 6.x BOM, not JUnit 4", () => {
    expect(plugin.JUNIT_BOM).toMatch(/^org\.junit:junit-bom:6\.\d+\.\d+$/);
    expect(plugin.addAppTests(APP_TEMPLATE)).not.toMatch(/junit:junit:4/);
  });

  it("writes no application ID of its own: the test JVM reads the one Gradle builds with", () => {
    const blocks = plugin.addAppTests(APP_TEMPLATE).slice(APP_TEMPLATE.length) + plugin.addRootTask(ROOT_TEMPLATE).slice(ROOT_TEMPLATE.length);
    expect(blocks).not.toMatch(/applicationId\s+['"]/);
    expect(blocks).not.toContain("example.app");
  });
});
