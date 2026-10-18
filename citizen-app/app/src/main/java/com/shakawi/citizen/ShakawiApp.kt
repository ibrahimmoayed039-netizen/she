package com.shakawi.citizen

import android.app.Application

/** يهيّئ Firebase عند بدء العملية (ضروري لاستلام الإشعارات والتطبيق مغلق) */
class ShakawiApp : Application() {
    override fun onCreate() {
        super.onCreate()
        try { FbConfig.init(this) } catch (e: Exception) { }
    }
}
