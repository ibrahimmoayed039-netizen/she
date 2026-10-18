package com.shakawi.citizen

import android.app.Activity
import android.content.Context
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import org.json.JSONObject

/** ربط Firebase وقت التشغيل: لا حاجة لتعديل التطبيق أو إعادة بنائه لكل زبون. */
object FbConfig {
    private const val PREFS = "fb_config"

    /** يهيّئ Firebase من الإعدادات المحفوظة. يعيد true إذا كان جاهزاً. */
    fun init(ctx: Context): Boolean {
        if (FirebaseApp.getApps(ctx).isNotEmpty()) return true
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val key = p.getString("apiKey", null)
        val app = p.getString("appId", null)
        val project = p.getString("projectId", null)
        if (key.isNullOrBlank() || app.isNullOrBlank() || project.isNullOrBlank()) {
            // إعدادات مدمجة وقت البناء داخل APK (assets/fb_config.json)
            val embedded = try {
                ctx.assets.open("fb_config.json").bufferedReader().use { it.readText() }
            } catch (e: Exception) { null }
            if (embedded == null || !saveFromJson(ctx, embedded)) return false
            return init(ctx)
        }
        return try {
            FirebaseApp.initializeApp(
                ctx,
                FirebaseOptions.Builder().setApiKey(key).setApplicationId(app).setProjectId(project)
                    .setGcmSenderId(app.split(":").getOrNull(1) ?: "").build()
            )
            true
        } catch (e: Exception) {
            false
        }
    }

    /** يقرأ محتوى google-services.json ويحفظ القيم الثلاث المطلوبة. */
    fun saveFromJson(ctx: Context, json: String): Boolean = try {
        val o = JSONObject(json)
        val project = o.getJSONObject("project_info").getString("project_id")
        val c = o.getJSONArray("client").getJSONObject(0)
        val app = c.getJSONObject("client_info").getString("mobilesdk_app_id")
        val key = c.getJSONArray("api_key").getJSONObject(0).getString("current_key")
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("apiKey", key).putString("appId", app).putString("projectId", project).apply()
        true
    } catch (e: Exception) {
        false
    }

    fun reset(ctx: Context) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
        Toast.makeText(ctx, "تم مسح الإعدادات، افتح التطبيق من جديد", Toast.LENGTH_LONG).show()
        (ctx as? Activity)?.finishAffinity()
    }
}

@Composable
fun SetupScreen(onDone: () -> Unit) {
    val ctx = LocalContext.current
    var pasted by remember { mutableStateOf("") }
    var err by remember { mutableStateOf("") }

    fun handle(json: String) {
        if (FbConfig.saveFromJson(ctx, json)) onDone()
        else err = "الملف غير صحيح. تأكد أنه google-services.json من مشروعك."
    }

    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) {
            val txt = try {
                ctx.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() } ?: ""
            } catch (e: Exception) { "" }
            handle(txt)
        }
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("ربط قاعدة البيانات", style = MaterialTheme.typography.headlineSmall)
        Text("هذه الخطوة تُنفَّذ مرة واحدة فقط. اختر ملف google-services.json الخاص بمشروع Firebase، أو الصق محتواه في الأسفل.")
        Button(onClick = { pick.launch(arrayOf("*/*")) }, modifier = Modifier.fillMaxWidth()) {
            Text("اختيار ملف google-services.json")
        }
        OutlinedTextField(
            pasted, { pasted = it }, label = { Text("أو الصق محتوى الملف هنا") },
            modifier = Modifier.fillMaxWidth().height(180.dp)
        )
        OutlinedButton(
            enabled = pasted.isNotBlank(), onClick = { handle(pasted) },
            modifier = Modifier.fillMaxWidth()
        ) { Text("حفظ واتصال") }
        if (err.isNotBlank()) Text(err, color = MaterialTheme.colorScheme.error)
    }
}
