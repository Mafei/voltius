import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = libs.versions.compile.sdk.get().toInt()
    buildToolsVersion = libs.versions.build.tools.get()
    ndkVersion = libs.versions.ndk.get()
    namespace = "com.voltius.app"
    signingConfigs {
        getByName("debug") {
            storeFile = file("$rootDir/../../../keystore/voltius-debug.keystore")
            storePassword = "voltius"
            keyAlias = "voltius-debug"
            keyPassword = "voltius"
        }
        // Release signing is supplied by CI via env vars (keystore decoded from a
        // GitHub secret). Absent locally → release config stays unconfigured and
        // the release buildType falls back below, so local debug builds are unaffected.
        create("release") {
            System.getenv("ANDROID_KEYSTORE_PATH")?.let { ksPath ->
                storeFile = file(ksPath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.voltius.app"
        minSdk = libs.versions.min.sdk.get().toInt()
        targetSdk = libs.versions.target.sdk.get().toInt()
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            // R8 shrinks and obfuscates the libraries (Play flags unobfuscated DEX).
            // Rust calls our Kotlin by name over JNI (VoltiusKeychain, VoltiusBiometric,
            // VoltiusTunnelService, ...), so proguard-rules.pro keeps com.voltius.app
            // whole; Tauri's own classes are kept by the rules its library ships.
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
                "proguard-tauri.pro",
            )
            // Only attach the release signing config when CI provided a keystore;
            // otherwise leave unsigned so a local `release` build still completes.
            if (System.getenv("ANDROID_KEYSTORE_PATH") != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_1_8) }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    // Align Tauri JSON modules and the encrypted-preferences crypto runtime.
    implementation(platform(libs.jackson.bom))
    implementation(libs.tink.android)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.appcompat)
    implementation(libs.androidx.activity)
    implementation(libs.material)
    implementation(libs.androidx.lifecycle.process)
    // Navy splash with the bolt, held until the first web paint (see SplashGate.kt).
    implementation(libs.androidx.splashscreen)
    // Hardware-backed secret storage for the OS keychain (see VoltiusKeychain.kt).
    implementation(libs.androidx.security.crypto)
    implementation(libs.androidx.biometric)
    // SAF tree writes for the SFTP download directory (see VoltiusDownloads.kt).
    implementation(libs.androidx.documentfile)
    testImplementation(libs.jackson.databind)
    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    androidTestImplementation(libs.android.test.junit)
    androidTestImplementation(libs.espresso)
}

apply(from = "tauri.build.gradle")
