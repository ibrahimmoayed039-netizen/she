plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "com.shakawi.citizen"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.shakawi.citizen"
        minSdk = 24
        targetSdk = 34
        // رقم الإصدار يزيد تلقائياً مع كل بناء في GitHub Actions ليقبله أندرويد كتحديث فوق القديم
        val run = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1
        versionCode = run
        versionName = "1.0.$run"
    }
    // مفتاح توقيع ثابت (shakawi.jks في جذر المستودع) حتى يبقى توقيع كل البنايات واحداً فيُحدَّث التطبيق دون حذفه
    signingConfigs {
        create("fixed") {
            storeFile = rootProject.file("../shakawi.jks")
            storePassword = "shakawi123"
            keyAlias = "shakawi"
            keyPassword = "shakawi123"
        }
    }
    buildTypes {
        getByName("debug") { signingConfig = signingConfigs.getByName("fixed") }
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
    implementation("com.google.android.gms:play-services-location:21.3.0")
}
