package com.shakawi.staff

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import android.os.Bundle
import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class Complaint(
    val id: String, val title: String, val text: String, val department: String,
    val priority: String, val summary: String, val status: String, val reply: String,
    val createdMs: Long, val imageB64: String, val name: String, val phone: String,
    val seenMs: Long, val lat: Double?, val lng: Double?, val resolvedImageB64: String
)

fun toComplaint(d: DocumentSnapshot) = Complaint(
    d.id, d.getString("title") ?: "", d.getString("text") ?: "",
    d.getString("department") ?: "", d.getString("priority") ?: "",
    d.getString("aiSummary") ?: "", d.getString("status") ?: "new",
    d.getString("reply") ?: "",
    d.getTimestamp("createdAt")?.toDate()?.time ?: 0L,
    d.getString("imageB64") ?: "", d.getString("name") ?: "", d.getString("phone") ?: "",
    d.getTimestamp("seenAt")?.toDate()?.time ?: 0L,
    d.getDouble("lat"), d.getDouble("lng"), d.getString("resolvedImageB64") ?: ""
)

fun priorityAr(p: String): String = when (p) {
    "urgent" -> "عاجلة"
    "high" -> "عالية"
    "medium" -> "متوسطة"
    "low" -> "منخفضة"
    else -> "-"
}

fun fmtTime(ms: Long): String =
    if (ms <= 0L) "-" else SimpleDateFormat("yyyy/MM/dd  hh:mm a", Locale.getDefault()).format(Date(ms))

/** تصغير الصورة (مع تصحيح اتجاهها من EXIF) وتحويلها إلى Base64 لتُخزَّن داخل Firestore */
fun compressImage(ctx: Context, uri: Uri): String {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    var sample = 1
    while (bounds.outWidth / sample > 1800) sample *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sample }
    val bmp = ctx.contentResolver.openInputStream(uri)!!.use { BitmapFactory.decodeStream(it, null, opts) }!!
    val rot = try {
        ctx.contentResolver.openInputStream(uri)?.use {
            when (ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
        } ?: 0f
    } catch (e: Exception) { 0f }
    val scale = minOf(1f, 900f / maxOf(bmp.width, bmp.height))
    val m = Matrix().apply { postScale(scale, scale); if (rot != 0f) postRotate(rot) }
    val out0 = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
    val out = ByteArrayOutputStream()
    out0.compress(Bitmap.CompressFormat.JPEG, 70, out)
    return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
}

/** يفتح موقع المواطن في تطبيق الخرائط (أو المتصفح إن لم يوجد تطبيق خرائط) */
fun openMap(ctx: Context, lat: Double, lng: Double, label: String) {
    val geo = Uri.parse("geo:$lat,$lng?q=$lat,$lng(${Uri.encode(label)})")
    try {
        ctx.startActivity(Intent(Intent.ACTION_VIEW, geo).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (e: Exception) {
        try {
            ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/search/?api=1&query=$lat,$lng")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e2: Exception) {
            android.widget.Toast.makeText(ctx, "لا يوجد تطبيق لفتح الخرائط", android.widget.Toast.LENGTH_LONG).show()
        }
    }
}

// يكتب حالة الموظف في قاعدة البيانات فتظهر فوراً في برنامج الحاسوب وعند المواطن
fun setStatus(id: String, status: String, reply: String, resolvedImageB64: String = "", onFail: (String) -> Unit = {}) {
    val ref = FirebaseFirestore.getInstance().collection("complaints").document(id)
    val data = mutableMapOf<String, Any>(
        "status" to status, "reply" to reply, "updatedAt" to FieldValue.serverTimestamp(),
        "handledBy" to (FirebaseAuth.getInstance().currentUser?.email ?: "")
    )
    if (status == "in_progress") data["startedAt"] = FieldValue.serverTimestamp()
    if (status == "resolved") data["resolvedAt"] = FieldValue.serverTimestamp()
    if (status == "resolved" && resolvedImageB64.isNotEmpty()) data["resolvedImageB64"] = resolvedImageB64
    ref.update(data).addOnFailureListener {
        // غالباً قواعد Firestore القديمة لا تسمح بالحقول الجديدة: نعيد المحاولة بالحقول الأساسية فقط
        ref.update(mapOf("status" to status, "reply" to reply, "updatedAt" to FieldValue.serverTimestamp()))
            .addOnSuccessListener {
                if (resolvedImageB64.isNotEmpty()) onFail("حُفظت الحالة لكن لم تُرسل الصورة. انشر قواعد firestore.rules الجديدة")
            }
            .addOnFailureListener { e -> onFail(e.message ?: "") }
    }
}

// عند فتح الشكوى لأول مرة يُسجَّل وقت اطلاع الموظف
fun markSeen(id: String) {
    FirebaseFirestore.getInstance().collection("complaints").document(id).update(
        mapOf(
            "seenAt" to FieldValue.serverTimestamp(),
            "handledBy" to (FirebaseAuth.getInstance().currentUser?.email ?: "")
        )
    )
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                MaterialTheme {
                    var ready by remember { mutableStateOf(FbConfig.init(applicationContext)) }
                    if (ready) Root() else SetupScreen { ready = FbConfig.init(applicationContext) }
                }
            }
        }
    }
}

@Composable
fun Root() {
    val auth = FirebaseAuth.getInstance()
    var user by remember { mutableStateOf(auth.currentUser) }
    DisposableEffect(Unit) {
        val l = FirebaseAuth.AuthStateListener { user = it.currentUser }
        auth.addAuthStateListener(l)
        onDispose { auth.removeAuthStateListener(l) }
    }
    val u = user
    if (u == null) Login() else Home(u.uid, u.email ?: "")
}

@Composable
fun Login() {
    val scope = rememberCoroutineScope()
    var email by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var err by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, androidx.compose.ui.Alignment.CenterVertically)
    ) {
        Text("تسجيل دخول الموظف", style = MaterialTheme.typography.headlineSmall)
        OutlinedTextField(email, { email = it }, label = { Text("البريد الإلكتروني") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(
            pass, { pass = it }, label = { Text("كلمة المرور") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth()
        )
        if (err.isNotBlank()) Text(err, color = MaterialTheme.colorScheme.error)
        Button(
            enabled = !busy && email.isNotBlank() && pass.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                scope.launch {
                    busy = true; err = ""
                    try {
                        FirebaseAuth.getInstance().signInWithEmailAndPassword(email.trim(), pass).await()
                    } catch (e: Exception) {
                        err = "فشل تسجيل الدخول، تحقق من البيانات والإنترنت"
                    }
                    busy = false
                }
            }
        ) { Text(if (busy) "جارٍ الدخول..." else "دخول") }
        val ctx = androidx.compose.ui.platform.LocalContext.current
        TextButton(onClick = { FbConfig.reset(ctx) }) { Text("تغيير إعدادات الاتصال بقاعدة البيانات") }
    }
}

@Composable
fun Home(uid: String, email: String) {
    var depts by remember { mutableStateOf<List<String>?>(null) }
    var loaded by remember { mutableStateOf(false) }
    LaunchedEffect(uid) {
        try {
            val doc = FirebaseFirestore.getInstance().collection("staff").document(uid).get().await()
            // يدعم عدة أقسام (الحقل departments مصفوفة) أو قسماً واحداً (الحقل department)
            val arr = (doc.get("departments") as? List<*>)?.mapNotNull { it as? String }?.filter { it.isNotBlank() }
            depts = if (!arr.isNullOrEmpty()) arr else doc.getString("department")?.takeIf { it.isNotBlank() }?.let { listOf(it) }
        } catch (e: Exception) { }
        loaded = true
    }
    val d = depts
    when {
        !loaded -> Box(Modifier.fillMaxSize().padding(24.dp)) { Text("جارٍ التحميل...") }
        d == null -> Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("هذا الحساب غير مرتبط بأي قسم. تواصل مع الإدارة.")
            Button(onClick = { FirebaseAuth.getInstance().signOut() }) { Text("تسجيل الخروج") }
        }
        else -> Main(d, email)
    }
}

@Composable
fun Main(depts: List<String>, email: String) {
    var list by remember { mutableStateOf(listOf<Complaint>()) }
    var tab by remember { mutableIntStateOf(0) }
    var selected by remember { mutableStateOf<Complaint?>(null) }

    DisposableEffect(depts) {
        // مستمع لكل قسم ثم دمج النتائج
        val parts = mutableMapOf<String, List<Complaint>>()
        val regs = depts.map { d ->
            FirebaseFirestore.getInstance().collection("complaints")
                .whereEqualTo("department", d)
                .addSnapshotListener { s, _ ->
                    if (s != null) {
                        parts[d] = s.documents.map { toComplaint(it) }
                        list = parts.values.flatten().sortedByDescending { it.createdMs }
                    }
                }
        }
        onDispose { regs.forEach { it.remove() } }
    }

    val statuses = listOf("routed", "in_progress", "resolved")
    val labels = listOf("📥" to "الجديدة", "🔧" to "قيد المعالجة", "✅" to "المنتهية", "👤" to "حسابي")

    Scaffold(bottomBar = {
        NavigationBar {
            labels.forEachIndexed { i, t ->
                val n = if (i < 3) list.count { it.status == statuses[i] } else 0
                NavigationBarItem(
                    selected = tab == i, onClick = { tab = i },
                    icon = { Text(t.first) },
                    label = { Text(if (i < 3) "${t.second} ($n)" else t.second) }
                )
            }
        }
    }) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            if (tab < 3) {
                val shown = list.filter { it.status == statuses[tab] }
                if (shown.isEmpty()) {
                    Box(Modifier.fillMaxSize().padding(24.dp)) { Text("لا توجد شكاوى هنا") }
                } else LazyColumn(
                    Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(shown, key = { it.id }) { c ->
                        Card(Modifier.fillMaxWidth().clickable { selected = c }) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(c.title, style = MaterialTheme.typography.titleMedium)
                                Text("الأولوية: " + priorityAr(c.priority), color = MaterialTheme.colorScheme.primary)
                                Text("🕒 وصلت: " + fmtTime(c.createdMs), style = MaterialTheme.typography.bodySmall)
                                Text(if (c.summary.isNotBlank()) c.summary else c.text, maxLines = 3)
                            }
                        }
                    }
                }
            } else {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("حسابي", style = MaterialTheme.typography.headlineSmall)
                    Text("البريد: $email")
                    Text("الأقسام: " + depts.joinToString("، "))
                    Button(onClick = { FirebaseAuth.getInstance().signOut() }) { Text("تسجيل الخروج") }
                }
            }
        }
    }

    selected?.let { c ->
        Detail(c) { selected = null }
    }
}

@Composable
fun Detail(c: Complaint, onClose: () -> Unit) {
    var reply by remember { mutableStateOf(c.reply) }
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var afterB64 by remember { mutableStateOf("") }
    var shotUri by remember { mutableStateOf<Uri?>(null) }

    fun loadPhoto(uri: Uri) {
        scope.launch {
            try { afterB64 = withContext(Dispatchers.IO) { compressImage(ctx, uri) } }
            catch (e: Exception) { android.widget.Toast.makeText(ctx, "تعذّر قراءة الصورة", android.widget.Toast.LENGTH_LONG).show() }
        }
    }
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { u -> if (u != null) loadPhoto(u) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok -> if (ok) shotUri?.let { loadPhoto(it) } }
    val afterBmp = remember(afterB64) {
        if (afterB64.isEmpty()) null else try {
            val b = Base64.decode(afterB64, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(b, 0, b.size)?.asImageBitmap()
        } catch (e: Exception) { null }
    }
    val doneBmp = remember(c.id, c.resolvedImageB64.length) {
        if (c.resolvedImageB64.isEmpty()) null else try {
            val b = Base64.decode(c.resolvedImageB64, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(b, 0, b.size)?.asImageBitmap()
        } catch (e: Exception) { null }
    }
    val onFail: (String) -> Unit = { m ->
        android.widget.Toast.makeText(ctx, "تعذّر حفظ الحالة، تحقق من الاتصال والصلاحيات: $m", android.widget.Toast.LENGTH_LONG).show()
    }
    LaunchedEffect(c.id) { if (c.status == "routed" && c.seenMs == 0L) markSeen(c.id) }
    val bmp = remember(c.id) {
        if (c.imageB64.isEmpty()) null else try {
            val b = Base64.decode(c.imageB64, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(b, 0, b.size)?.asImageBitmap()
        } catch (e: Exception) { null }
    }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(c.title) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("🕒 وقت الاستلام: " + fmtTime(c.createdMs))
                Text("الأولوية: " + priorityAr(c.priority))
                if (c.summary.isNotBlank()) Text("ملخص: " + c.summary)
                Text(c.text)
                if (bmp != null) Image(bitmap = bmp, contentDescription = null, modifier = Modifier.fillMaxWidth())
                if (c.name.isNotBlank() || c.phone.isNotBlank()) Text("المواطن: ${c.name} ${c.phone}")
                if (c.lat != null && c.lng != null) {
                    Text("📍 موقع الشكوى: %.5f ، %.5f".format(c.lat, c.lng))
                    OutlinedButton(onClick = { openMap(ctx, c.lat, c.lng, c.title) }, modifier = Modifier.fillMaxWidth()) {
                        Text("🗺️ فتح الموقع في الخرائط")
                    }
                } else Text("لم يرسل المواطن موقعاً", style = MaterialTheme.typography.bodySmall)
                if (c.status == "resolved") {
                    if (doneBmp != null) {
                        Text("📷 صورة بعد الحل:")
                        Image(bitmap = doneBmp, contentDescription = null, modifier = Modifier.fillMaxWidth())
                    }
                } else {
                    Text("📷 صورة بعد الحل (تصل للمواطن):")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = {
                            val dir = File(ctx.cacheDir, "shots").apply { mkdirs() }
                            val f = File(dir, "after_${System.currentTimeMillis()}.jpg")
                            val u = FileProvider.getUriForFile(ctx, ctx.packageName + ".fileprovider", f)
                            shotUri = u
                            try { camera.launch(u) } catch (e: Exception) {
                                android.widget.Toast.makeText(ctx, "تعذّر فتح الكاميرا", android.widget.Toast.LENGTH_LONG).show()
                            }
                        }) { Text("التقاط") }
                        OutlinedButton(onClick = { gallery.launch("image/*") }) { Text("من المعرض") }
                    }
                    if (afterBmp != null) {
                        Image(bitmap = afterBmp, contentDescription = null, modifier = Modifier.fillMaxWidth())
                        TextButton(onClick = { afterB64 = "" }) { Text("إزالة الصورة") }
                    }
                }
                OutlinedTextField(reply, { reply = it }, label = { Text("الرد على المواطن") }, modifier = Modifier.fillMaxWidth())
            }
        },
        confirmButton = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (c.status == "routed") Button(onClick = { setStatus(c.id, "in_progress", reply, "", onFail); onClose() }) { Text("بدء المعالجة") }
                if (c.status != "resolved") Button(onClick = { setStatus(c.id, "resolved", reply, afterB64, onFail); onClose() }) { Text("تم الحل") }
            }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("إغلاق") } }
    )
}
