plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
// رقم الإصدار يُمرَّر من GitHub Actions ويزداد تلقائياً مع كل بناء (-PverCode=رقم)
val verCode = (project.findProperty("verCode") as String?)?.toIntOrNull() ?: 1
android {
    namespace = "com.shakawi.citizen"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.shakawi.citizen"
        minSdk = 24
        targetSdk = 34
        versionCode = verCode
        versionName = "1.0.$verCode"
    }
    // توقيع ثابت لكل البنايات حتى يُحدَّث التطبيق فوق القديم بدون حذف
    signingConfigs {
        create("shakawi") {
            storeFile = file("../../keystore/shakawi.jks")
            storePassword = "shakawi123"
            keyAlias = "shakawi"
            keyPassword = "shakawi123"
        }
    }
    buildTypes {
        getByName("debug") { signingConfig = signingConfigs.getByName("shakawi") }
    }
    buildFeatures { compose = true }
    composeOptions { kotlinCompilerExtensionVersion = "1.5.14" }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.06.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.9.0")
    implementation(platform("com.google.firebase:firebase-bom:33.1.2"))
    implementation("com.google.firebase:firebase-firestore")
    implementation("com.google.firebase:firebase-auth")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.8.1")
}
