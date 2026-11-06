package com.shakawi.citizen

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Looper
import androidx.compose.foundation.Image
import androidx.compose.ui.graphics.asImageBitmap
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull
import java.io.ByteArrayOutputStream

data class Complaint(
    val id: String, val title: String, val text: String, val department: String,
    val status: String, val reply: String, val createdMs: Long,
    val afterB64: String, val rating: Long, val confirmed: Boolean, val reopenCount: Long,
    val hasCrew: Boolean, val arrived: Boolean
)

fun toComplaint(d: DocumentSnapshot) = Complaint(
    d.id, d.getString("title") ?: "", d.getString("text") ?: "",
    d.getString("department") ?: "", d.getString("status") ?: "new",
    d.getString("reply") ?: "",
    d.getTimestamp("createdAt")?.toDate()?.time ?: System.currentTimeMillis(),
    d.getString("afterImageB64") ?: "", d.getLong("rating") ?: 0L,
    d.getBoolean("confirmed") ?: false, d.getLong("reopenCount") ?: 0L,
    !d.getString("crew").isNullOrBlank(), d.getTimestamp("arrivedAt") != null
)

/** تتبّع الشكوى للمواطن: استُلمت › وُجِّهت › أُسندت لكادر › وصل الكادر › أُنجزت */
fun trackLine(c: Complaint): String {
    val steps = listOf(
        "استُلمت" to true,
        "وُجِّهت للقسم" to (c.status != "new"),
        "أُسندت لكادر الصيانة" to (c.hasCrew || c.status == "resolved"),
        "وصل الكادر" to (c.arrived || c.status == "resolved"),
        "أُنجزت" to (c.status == "resolved")
    )
    val cur = steps.indexOfFirst { !it.second }
    return steps.mapIndexed { i, s -> (if (s.second) "✔ " else if (i == cur) "⏳ " else "○ ") + s.first }.joinToString(" › ")
}

fun trackSteps(c: Complaint): List<Pair<String, Boolean>> = listOf(
    "استُلمت" to true,
    "وُجِّهت للقسم" to (c.status != "new"),
    "أُسندت لكادر" to (c.hasCrew || c.status == "resolved"),
    "وصل الكادر" to (c.arrived || c.status == "resolved"),
    "أُنجزت" to (c.status == "resolved")
)

fun statusColor(s: String): Color = when (s) {
    "routed" -> Sk.Teal
    "in_progress", "pending_review" -> Sk.Amber
    "resolved" -> Sk.Green
    else -> Sk.Slate
}

@Composable
fun StatusPill(s: String) {
    Pill(statusAr(s), statusColor(s), if (s == "in_progress" || s == "pending_review") Sk.Ink else Color.White)
}

fun statusAr(s: String) = when (s) {
    "new" -> "قيد المراجعة"
    "routed" -> "تم التوجيه للقسم"
    "in_progress", "pending_review" -> "قيد المعالجة"
    "resolved" -> "تم الحل"
    else -> s
}

/** تصغير الصورة وتحويلها إلى Base64 (تُخزَّن داخل Firestore بلا حاجة لـ Storage) */
fun compressImage(ctx: Context, uri: Uri): String {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    var sample = 1
    while (bounds.outWidth / sample > 1800) sample *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sample }
    val bmp = ctx.contentResolver.openInputStream(uri)!!.use { BitmapFactory.decodeStream(it, null, opts) }!!
    val scale = minOf(1f, 900f / maxOf(bmp.width, bmp.height))
    val scaled = Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true)
    val out = ByteArrayOutputStream()
    scaled.compress(Bitmap.CompressFormat.JPEG, 70, out)
    return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
}

/** يحدد الموقع الحالي: آخر موقع معروف إن كان حديثاً، وإلا طلب موقع جديد (حتى 12 ثانية) */
@SuppressLint("MissingPermission")
suspend fun getMyLocation(ctx: Context): Pair<Double, Double>? {
    val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    val provs = try { lm.getProviders(true) } catch (e: Exception) { emptyList() }
    var best: Location? = null
    for (p in provs) {
        val l = try { lm.getLastKnownLocation(p) } catch (e: Exception) { null }
        if (l != null && (best == null || l.time > best.time)) best = l
    }
    if (best != null && System.currentTimeMillis() - best.time < 5 * 60_000) return best.latitude to best.longitude
    val prov = when {
        provs.contains(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
        provs.contains(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
        else -> null
    }
    if (prov != null) {
        val fresh = withTimeoutOrNull(12000) {
            suspendCancellableCoroutine<Location?> { c ->
                val l = object : LocationListener {
                    override fun onLocationChanged(loc: Location) { if (c.isActive) c.resume(loc) }
                    override fun onProviderEnabled(p: String) {}
                    override fun onProviderDisabled(p: String) {}
                    @Deprecated("old API")
                    override fun onStatusChanged(p: String?, s: Int, e: Bundle?) {}
                }
                try { lm.requestSingleUpdate(prov, l, Looper.getMainLooper()) } catch (e: Exception) { if (c.isActive) c.resume(null) }
                c.invokeOnCancellation { try { lm.removeUpdates(l) } catch (e: Exception) { } }
            }
        }
        if (fresh != null) return fresh.latitude to fresh.longitude
    }
    return best?.let { it.latitude to it.longitude }
}

/** المواطن يؤكد أن المشكلة حُلّت فعلاً */
fun confirmDone(id: String) {
    FirebaseFirestore.getInstance().collection("complaints").document(id).update(
        mapOf("confirmed" to true, "confirmedAt" to FieldValue.serverTimestamp())
    )
}

/** المواطن يعيد فتح الشكوى: تعود للقسم (routed) وتُمسح علامة وصول الكادر ليصل من جديد */
fun reopenComplaint(id: String, oldCount: Long, reason: String) {
    FirebaseFirestore.getInstance().collection("complaints").document(id).update(
        mapOf(
            "status" to "routed", "reopenCount" to oldCount + 1, "reopenedAt" to FieldValue.serverTimestamp(),
            "reopenReason" to reason.trim().take(300), "arrivedAt" to FieldValue.delete(),
            "updatedAt" to FieldValue.serverTimestamp()
        )
    )
}

fun rateComplaint(id: String, n: Int) {
    FirebaseFirestore.getInstance().collection("complaints").document(id).update(
        mapOf("rating" to n, "ratedAt" to FieldValue.serverTimestamp())
    )
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                ShakawiTheme {
                    var ready by remember { mutableStateOf(FbConfig.init(applicationContext)) }
                    if (ready) {
                        val notifPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
                        LaunchedEffect(Unit) {
                            if (Build.VERSION.SDK_INT >= 33) notifPerm.launch(Manifest.permission.POST_NOTIFICATIONS)
                        }
                        LaunchedEffect(Unit) {
                            val a = FirebaseAuth.getInstance()
                            if (a.currentUser == null) a.signInAnonymously()
                        }
                        App()
                    } else {
                        SetupScreen { ready = FbConfig.init(applicationContext) }
                    }
                }
            }
        }
    }
}

@Composable
fun App() {
    val auth = FirebaseAuth.getInstance()
    var uid by remember { mutableStateOf(auth.currentUser?.uid) }
    DisposableEffect(Unit) {
        val l = FirebaseAuth.AuthStateListener { uid = it.currentUser?.uid }
        auth.addAuthStateListener(l)
        onDispose { auth.removeAuthStateListener(l) }
    }
    var tab by remember { mutableIntStateOf(0) }
    val tabs = listOf("✏️" to "شكوى جديدة", "📋" to "شكاواي", "⚙️" to "الإعدادات")
    Scaffold(containerColor = Color.Transparent, bottomBar = {
        DepthDock {
            tabs.forEachIndexed { i, t ->
                DockItem(
                    selected = tab == i, onClick = { tab = i },
                    icon = { Text(t.first) }, label = { Text(t.second) }
                )
            }
        }
    }) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            when (tab) {
                0 -> NewTab { tab = 1 }
                1 -> MyTab(uid)
                else -> SettingsTab()
            }
        }
    }
}

@Composable
fun NewTab(onSent: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var title by remember { mutableStateOf("") }
    var text by remember { mutableStateOf("") }
    var img by remember { mutableStateOf<Uri?>(null) }
    var busy by remember { mutableStateOf(false) }
    // أنواع الشكاوى (الأقسام) من برنامج الحاسوب، لتوجيه أدق وأسرع
    var cats by remember { mutableStateOf<List<String>>(emptyList()) }
    var category by remember { mutableStateOf("") }
    // الأحياء: (القسم، القاطع، المنطقة) من برنامج الحاسوب، فيختار المواطن حيّه بدل أن يخمّنه البرنامج من النص
    var areaOpts by remember { mutableStateOf<List<Triple<String, String, String>>>(emptyList()) }
    var area by remember { mutableStateOf<Triple<String, String, String>?>(null) }
    LaunchedEffect(Unit) {
        try {
            val ac = FirebaseFirestore.getInstance().collection("config").document("areas").get().await()
            areaOpts = (ac.get("list") as? List<*>)?.flatMap { e ->
                val m = e as? Map<*, *> ?: return@flatMap emptyList<Triple<String, String, String>>()
                val d = (m["dept"] as? String)?.trim() ?: ""
                val s = (m["name"] as? String)?.trim() ?: ""
                (m["areas"] as? List<*>)?.mapNotNull { (it as? String)?.trim()?.takeIf { a -> a.isNotEmpty() } }
                    ?.map { a -> Triple(d, s, a) } ?: emptyList()
            } ?: emptyList()
        } catch (e: Exception) { }
    }
    LaunchedEffect(Unit) {
        try {
            val dc = FirebaseFirestore.getInstance().collection("config").document("departments").get().await()
            cats = (dc.get("list") as? List<*>)?.mapNotNull { (it as? String)?.trim() }?.filter { it.isNotEmpty() } ?: emptyList()
        } catch (e: Exception) { }
    }
    var loc by remember { mutableStateOf<Pair<Double, Double>?>(null) }
    var locBusy by remember { mutableStateOf(false) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { img = it }
    fun fetchLoc() {
        scope.launch {
            locBusy = true
            loc = try { getMyLocation(ctx) } catch (e: Exception) { null }
            locBusy = false
            if (loc == null) Toast.makeText(ctx, "تعذر تحديد الموقع، فعّل GPS وحاول مجدداً", Toast.LENGTH_LONG).show()
        }
    }
    val locPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) fetchLoc() else Toast.makeText(ctx, "لم يُسمح بالوصول إلى الموقع", Toast.LENGTH_SHORT).show()
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        ScreenTitle("شكوى جديدة", "صِف المشكلة وسنوجّهها للجهة المختصة")
        DepthCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                DepthField(title, { title = it }, label = { Text("عنوان الشكوى") }, modifier = Modifier.fillMaxWidth())
                DepthField(
                    text, { text = it }, label = { Text("تفاصيل الشكوى") },
                    modifier = Modifier.fillMaxWidth().height(160.dp)
                )
            }
        }
        if (cats.isNotEmpty()) {
            SectionLabel("نوع الشكوى (اختياري)")
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(vertical = 8.dp, horizontal = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                cats.forEach { k -> ChoiceChip(k, category == k, onClick = { category = if (category == k) "" else k }) }
            }
        }
        // الأحياء المعروضة: أحياء القسم المختار، أو كل الأحياء إن لم يُختر نوع
        val shownAreas = areaOpts.filter { category.isBlank() || it.first == category }.distinctBy { it.third }
        // اختيار الحي إجباري متى وُجدت أحياء مُعرَّفة (ولا يُحسب اختيار قديم لا ينتمي للقائمة المعروضة)
        val areaOk = shownAreas.isEmpty() || (area != null && shownAreas.any { it.third == area!!.third })
        if (shownAreas.isNotEmpty()) {
            SectionLabel("الحي / المنطقة (إجباري)")
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(vertical = 8.dp, horizontal = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                shownAreas.forEach { o -> ChoiceChip(o.third, area?.third == o.third, onClick = { area = if (area?.third == o.third) null else o }) }
            }
        }
        if (!areaOk) Alert("اختر الحي / المنطقة لإرسال الشكوى")
        GhostButton(onClick = { pick.launch("image/*") }, modifier = Modifier.fillMaxWidth()) {
            Text(if (img == null) "📷 إرفاق صورة" else "📷 تم اختيار صورة ✓ (تغيير)")
        }
        GhostButton(
            enabled = !locBusy, modifier = Modifier.fillMaxWidth(),
            onClick = {
                if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) fetchLoc()
                else locPerm.launch(Manifest.permission.ACCESS_FINE_LOCATION)
            }
        ) { Text(if (locBusy) "جارٍ تحديد الموقع..." else if (loc == null) "📍 إرفاق موقعي الحالي" else "📍 تم تحديد الموقع ✓ (تحديث)") }
        DepthButton(
            enabled = !busy && title.isNotBlank() && text.isNotBlank() && areaOk,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                scope.launch {
                    busy = true
                    try {
                        val auth = FirebaseAuth.getInstance()
                        val uid = auth.currentUser?.uid
                            ?: withTimeoutOrNull(8000) { auth.signInAnonymously().await().user?.uid }
                            ?: throw Exception("تعذر تسجيل الدخول، تحقق من الإنترنت")
                        val prefs = ctx.getSharedPreferences("p", Context.MODE_PRIVATE)
                        val b64 = img?.let { compressImage(ctx, it) } ?: ""
                        val data = hashMapOf<String, Any>(
                            "userId" to uid, "title" to title.trim(), "text" to text.trim(),
                            "imageB64" to b64,
                            "name" to (prefs.getString("name", "") ?: ""),
                            "phone" to (prefs.getString("phone", "") ?: ""),
                            "department" to "", "priority" to "", "aiSummary" to "",
                            "status" to "new", "reply" to "",
                            "createdAt" to FieldValue.serverTimestamp()
                        )
                        loc?.let { data["lat"] = it.first; data["lng"] = it.second }
                        if (category.isNotBlank()) data["category"] = category
                        area?.takeIf { a -> shownAreas.any { it.third == a.third } }?.let { data["area"] = it.third; data["sector"] = it.second }
                        // رمز الإشعارات ليصل المواطن تنبيه عند تغيّر حالة شكواه
                        try {
                            withTimeoutOrNull(4000) { FirebaseMessaging.getInstance().token.await() }
                                ?.let { data["fcmToken"] = it }
                        } catch (e: Exception) { }
                        val sent = withTimeoutOrNull(10000) {
                            FirebaseFirestore.getInstance().collection("complaints").add(data).await()
                        }
                        Toast.makeText(
                            ctx,
                            if (sent != null) "تم إرسال الشكوى" else "سيتم الإرسال عند توفر الإنترنت",
                            Toast.LENGTH_LONG
                        ).show()
                        title = ""; text = ""; img = null; loc = null; category = ""; area = null
                        onSent()
                    } catch (e: Exception) {
                        Toast.makeText(ctx, e.message ?: "حدث خطأ", Toast.LENGTH_LONG).show()
                    }
                    busy = false
                }
            }
        ) { Text(if (busy) "جارٍ الإرسال..." else "إرسال الشكوى") }
    }
}

@Composable
fun MyTab(uid: String?) {
    var list by remember { mutableStateOf(listOf<Complaint>()) }
    var reopenId by remember { mutableStateOf<String?>(null) }
    var reopenOld by remember { mutableStateOf(0L) }
    var reason by remember { mutableStateOf("") }
    DisposableEffect(uid) {
        if (uid == null) return@DisposableEffect onDispose { }
        val reg = FirebaseFirestore.getInstance().collection("complaints")
            .whereEqualTo("userId", uid)
            .addSnapshotListener { s, _ ->
                if (s != null) list = s.documents.map { toComplaint(it) }.sortedByDescending { it.createdMs }
            }
        onDispose { reg.remove() }
    }
    reopenId?.let { rid ->
        AlertDialog(
            onDismissRequest = { reopenId = null },
            title = { Text("لماذا لم تُحل المشكلة؟") },
            text = { DepthField(reason, { reason = it }, label = { Text("اكتب السبب (اختياري)") }, modifier = Modifier.fillMaxWidth()) },
            confirmButton = { DepthButton(onClick = { reopenComplaint(rid, reopenOld, reason); reopenId = null; reason = "" }) { Text("إعادة فتح الشكوى") } },
            dismissButton = { LinkButton(onClick = { reopenId = null }) { Text("إلغاء") } }
        )
    }
    if (list.isEmpty()) {
        EmptyState("📋", "لا توجد شكاوى بعد", "أرسل أول شكوى من تبويب «شكوى جديدة» وتابع حالتها هنا")
        return
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item { ScreenTitle("شكاواي", "${list.size} شكوى") }
        items(list, key = { it.id }) { c ->
            DepthCard(Modifier.fillMaxWidth(), accent = statusColor(c.status)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(c.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                        StatusPill(c.status)
                    }
                    if (c.department.isNotBlank()) Text("القسم: " + c.department, style = MaterialTheme.typography.bodySmall, color = Sk.Muted)
                    Tracker(trackSteps(c))
                    Text(c.text)
                    if (c.reply.isNotBlank()) Note(c.reply, tone = Sk.Teal, title = "رد الجهة المختصة")
                    if (c.afterB64.isNotEmpty()) {
                        val ab = remember(c.id, c.afterB64.length) {
                            try {
                                val b = Base64.decode(c.afterB64, Base64.DEFAULT)
                                BitmapFactory.decodeByteArray(b, 0, b.size)?.asImageBitmap()
                            } catch (e: Exception) { null }
                        }
                        if (ab != null) {
                            Text("صورة بعد الصيانة:")
                            Image(bitmap = ab, contentDescription = null, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)))
                        }
                    }
                    if (c.reopenCount > 0) Note("🔁 أُعيد فتحها " + c.reopenCount + " مرة", tone = Sk.Orange)
                    if (c.status == "resolved") {
                        if (!c.confirmed && c.rating == 0L) {
                            Text("هل تم حل المشكلة فعلاً؟", style = MaterialTheme.typography.titleSmall)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                DepthButton(onClick = { confirmDone(c.id) }, modifier = Modifier.weight(1f)) { Text("✅ نعم، تم الحل") }
                                if (c.reopenCount < 3) GhostButton(onClick = { reopenId = c.id; reopenOld = c.reopenCount }, modifier = Modifier.weight(1f)) { Text("❌ لا، لم تُحل") }
                            }
                        } else if (c.rating > 0) Text("تقييمك: " + "⭐".repeat(c.rating.toInt()))
                        else {
                            Text("قيّم الخدمة:")
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                (1..5).forEach { n ->
                                    ChoiceChip("$n ⭐", false, onClick = { rateComplaint(c.id, n) })
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun SettingsTab() {
    val ctx = LocalContext.current
    val prefs = remember { ctx.getSharedPreferences("p", Context.MODE_PRIVATE) }
    var name by remember { mutableStateOf(prefs.getString("name", "") ?: "") }
    var phone by remember { mutableStateOf(prefs.getString("phone", "") ?: "") }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        ScreenTitle("الإعدادات", "بياناتك تُحفظ على جهازك وتُرفق مع شكاواك لتسهيل التواصل.")
        DepthCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                DepthField(name, { name = it }, label = { Text("الاسم (اختياري)") }, modifier = Modifier.fillMaxWidth())
                DepthField(phone, { phone = it }, label = { Text("رقم الهاتف (اختياري)") }, modifier = Modifier.fillMaxWidth())
            }
        }
        DepthButton(onClick = {
            prefs.edit().putString("name", name).putString("phone", phone).apply()
            Toast.makeText(ctx, "تم الحفظ", Toast.LENGTH_SHORT).show()
        }, modifier = Modifier.fillMaxWidth()) { Text("حفظ") }
    }
}
