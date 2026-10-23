package com.shakawi.staff

import android.Manifest
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import com.google.firebase.firestore.Query
import com.google.firebase.messaging.FirebaseMessaging
import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
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
import androidx.compose.runtime.saveable.rememberSaveable
import kotlinx.coroutines.delay
import androidx.compose.ui.Alignment
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

data class Complaint(
    val id: String, val title: String, val text: String, val department: String,
    val priority: String, val summary: String, val status: String, val reply: String,
    val createdMs: Long, val imageB64: String, val name: String, val phone: String,
    val branch: String, val repairable: Boolean?, val materials: String, val crew: String,
    val lat: Double?, val lng: Double?, val afterB64: String, val dupTitle: String,
    val dupCount: Long, val rating: Long, val arrivedMs: Long,
    val reopenCount: Long, val reopenReason: String, val confirmed: Boolean,
    val materialsReady: Boolean, val assessedMs: Long,
    val materialsStatus: String, val materialsNote: String, val returnNote: String,
    val blockedReason: String, val blockedBy: String
)

fun toComplaint(d: DocumentSnapshot) = Complaint(
    d.id, d.getString("title") ?: "", d.getString("text") ?: "",
    d.getString("department") ?: "", d.getString("priority") ?: "",
    d.getString("aiSummary") ?: "", d.getString("status") ?: "new",
    d.getString("reply") ?: "",
    d.getTimestamp("createdAt")?.toDate()?.time ?: 0L,
    d.getString("imageB64") ?: "", d.getString("name") ?: "", d.getString("phone") ?: "",
    d.getString("branch") ?: "", d.getBoolean("repairable"), d.getString("materials") ?: "",
    d.getString("crew") ?: "",
    d.getDouble("lat"), d.getDouble("lng"), d.getString("afterImageB64") ?: "",
    d.getString("dupTitle") ?: "", d.getLong("dupCount") ?: 0L, d.getLong("rating") ?: 0L,
    d.getTimestamp("arrivedAt")?.toDate()?.time ?: 0L,
    d.getLong("reopenCount") ?: 0L, d.getString("reopenReason") ?: "", d.getBoolean("confirmed") ?: false,
    d.getBoolean("materialsReady") ?: false, d.getTimestamp("assessedAt")?.toDate()?.time ?: 0L,
    d.getString("materialsStatus") ?: "", d.getString("materialsNote") ?: "", d.getString("returnNote") ?: "",
    d.getString("blockedReason") ?: "", d.getString("blockedBy") ?: ""
)

fun priorityAr(p: String): String = when (p) {
    "urgent" -> "عاجلة"
    "high" -> "عالية"
    "medium" -> "متوسطة"
    "low" -> "منخفضة"
    else -> "-"
}

/** سجل الشكوى: من فعل ماذا ومتى (مجموعة فرعية log داخل الشكوى) */
/** الاسم المخصص للحساب (الحقل name في مستند staff) ويظهر في سجل الشكاوى بدل البريد */
var myDisplayName: String = ""

/** سياق التطبيق لعرض رسائل الخطأ من الدوال العامة */
var appCtx: android.content.Context? = null

/** عند رفض الحفظ (قواعد Firestore أو الشبكة) تظهر رسالة بدل الصمت */
fun com.google.android.gms.tasks.Task<*>.alertOnFail(what: String) {
    addOnFailureListener { e ->
        appCtx?.let { android.widget.Toast.makeText(it, "تعذّر " + what + ": " + (e.message ?: ""), android.widget.Toast.LENGTH_LONG).show() }
    }
}

fun logEvent(id: String, action: String) {
    val by = myDisplayName.ifBlank { FirebaseAuth.getInstance().currentUser?.email ?: "موظف" }
    FirebaseFirestore.getInstance().collection("complaints").document(id).collection("log")
        .add(mapOf("by" to by, "action" to action, "at" to FieldValue.serverTimestamp()))
}

/** حالة المواد: requested › preparing › partial › ready › received */
fun matStatus(c: Complaint): String = when {
    c.materialsStatus.isNotBlank() -> c.materialsStatus
    c.materialsReady -> "ready"
    else -> "requested"
}

fun matStatusAr(s: String) = when (s) {
    "preparing" -> "⏳ قيد التجهيز"
    "partial" -> "⚠️ نقص جزئي"
    "ready" -> "✅ جاهزة بانتظار استلام الكادر"
    "received" -> "✅ استلمها الكادر"
    else -> "📦 مطلوبة بانتظار التجهيز"
}

/** شريط مراحل الشكوى: استُلمت › وُجِّهت › أُسندت › الكشف › المواد › الإنجاز › الاعتماد */
fun stageLine(c: Complaint): String {
    val fin = c.status == "resolved"
    val sent = fin || c.status == "pending_review"
    val steps = mutableListOf<Pair<String, Boolean>>()
    steps += "استُلمت" to true
    steps += "وُجِّهت" to (c.status != "new")
    steps += "أُسندت" to c.crew.isNotBlank()
    steps += "الكشف" to (c.arrivedMs > 0 || c.assessedMs > 0 || sent)
    if (c.repairable == false) steps += "🚫 غير ممكن الصيانة" to false
    else if (c.repairable == true && c.materials.isNotBlank()) steps += "المواد" to (matStatus(c) == "ready" || matStatus(c) == "received" || sent)
    steps += "الإنجاز" to sent
    if (c.crew.isNotBlank() || sent) steps += "اعتماد القسم" to fin
    val cur = steps.indexOfFirst { !it.second }
    return steps.mapIndexed { i, s -> (if (s.second) "✔ " else if (i == cur) "⏳ " else "○ ") + s.first }.joinToString(" › ")
}

/** تأكيد تجهيز المواد المطلوبة (موظف القسم) فيصل الكادر إشعار من برنامج الحاسوب */
fun markMaterialsReady(id: String) {
    val ts = FieldValue.serverTimestamp()
    FirebaseFirestore.getInstance().collection("complaints").document(id)
        .update(mapOf("materialsReady" to true, "materialsStatus" to "ready", "materialsNote" to "", "materialsReadyAt" to ts, "updatedAt" to ts))
        .addOnSuccessListener { logEvent(id, "جُهِّزت المواد المطلوبة") }
        .alertOnFail("حفظ تجهيز المواد")
}

/** قيد التجهيز أو نقص جزئي (مع ذكر الناقص) */
fun setMaterialsStatus(id: String, status: String, note: String) {
    val ts = FieldValue.serverTimestamp()
    FirebaseFirestore.getInstance().collection("complaints").document(id)
        .update(mapOf("materialsReady" to false, "materialsStatus" to status, "materialsNote" to note, "updatedAt" to ts))
        .addOnSuccessListener { logEvent(id, if (status == "partial") "نقص جزئي في المواد — الناقص: $note" else "المواد قيد التجهيز") }
        .alertOnFail("حفظ حالة المواد")
}

/** الكادر يؤكد استلام المواد */
fun markMaterialsReceived(id: String, crew: String) {
    val ts = FieldValue.serverTimestamp()
    FirebaseFirestore.getInstance().collection("complaints").document(id)
        .update(mapOf("materialsStatus" to "received", "materialsReceivedAt" to ts, "updatedAt" to ts))
        .addOnSuccessListener { logEvent(id, "استلم الكادر $crew المواد") }
        .alertOnFail("تأكيد استلام المواد")
}

/** القسم يعتمد إنجاز الكادر فيصل المواطن */
fun approveCompletion(id: String) {
    val ts = FieldValue.serverTimestamp()
    FirebaseFirestore.getInstance().collection("complaints").document(id)
        .update(mapOf("status" to "resolved", "approvedAt" to ts, "updatedAt" to ts))
        .addOnSuccessListener { logEvent(id, "اعتمد القسم الإنجاز وأُرسل للمواطن") }
        .alertOnFail("اعتماد الإنجاز")
}

/** القسم يعيد العمل للكادر مع ملاحظة */
fun returnToCrew(id: String, note: String) {
    val ts = FieldValue.serverTimestamp()
    FirebaseFirestore.getInstance().collection("complaints").document(id)
        .update(mapOf("status" to "in_progress", "returnNote" to note, "returnedAt" to ts, "updatedAt" to ts))
        .addOnSuccessListener { logEvent(id, "أرجع الإنجاز للكادر — $note") }
        .alertOnFail("إرجاع الإنجاز")
}

/** تعذّر العمل: يُخلي الكادر الشكوى فتعود للقسم مع السبب (دفعة واحدة مع السجل) */
fun blockWork(id: String, crew: String, reason: String, onResult: (String?) -> Unit) {
    val db = FirebaseFirestore.getInstance()
    val ref = db.collection("complaints").document(id)
    val ts = FieldValue.serverTimestamp()
    val batch = db.batch()
    batch.update(ref, mapOf(
        "status" to "routed", "crew" to "", "blockedReason" to reason, "blockedBy" to crew,
        "blockedAt" to ts, "arrivedAt" to FieldValue.delete(), "updatedAt" to ts
    ))
    batch.set(ref.collection("log").document(), mapOf(
        "by" to myDisplayName.ifBlank { crew },
        "action" to "تعذّر العمل على الكادر $crew — السبب: $reason — وأُعيدت للقسم",
        "at" to ts
    ))
    batch.commit().addOnSuccessListener { onResult(null) }.addOnFailureListener { e -> onResult(e.message ?: "خطأ غير معروف") }
}

/** الأكثر إلحاحاً أولاً */
fun priorityRank(p: String): Int = when (p) { "urgent" -> 0; "high" -> 1; "medium" -> 2; "low" -> 3; else -> 4 }

fun setStatus(id: String, status: String, reply: String) {
    val m = mutableMapOf<String, Any>("status" to status, "reply" to reply, "updatedAt" to FieldValue.serverTimestamp())
    if (status == "in_progress") m["startedAt"] = FieldValue.serverTimestamp()
    if (status == "resolved") m["resolvedAt"] = FieldValue.serverTimestamp()
    FirebaseFirestore.getInstance().collection("complaints").document(id).update(m)
        .addOnSuccessListener {
            logEvent(id, (if (status == "resolved") "أنهى الشكوى (تم الحل)" else "بدأ المعالجة") +
                (if (reply.isNotBlank()) " — الرد: $reply" else ""))
        }
        .alertOnFail("حفظ الحالة")
}

/** اسم موضوع الإشعارات للقسم (ترميز سداسي لأن الأسماء العربية غير مسموحة في أسماء المواضيع) */
fun deptTopic(d: String) = "d" + d.toByteArray(Charsets.UTF_8).joinToString("") { "%02x".format(it) }

/** موضوع إشعارات كادر بعينه (قسم|كادر) */
fun crewTopic(dept: String, crew: String) = "k" + (dept + "|" + crew).toByteArray(Charsets.UTF_8).joinToString("") { "%02x".format(it) }

/** وصول الكادر إلى الموقع: تبدأ المعالجة تلقائياً ويصل المواطن إشعار */
fun markArrived(id: String, status: String, crew: String) {
    val ts = FieldValue.serverTimestamp()
    val m = mutableMapOf<String, Any>("arrivedAt" to ts, "updatedAt" to ts)
    if (status == "routed") { m["status"] = "in_progress"; m["startedAt"] = ts }
    FirebaseFirestore.getInstance().collection("complaints").document(id).update(m)
        .addOnSuccessListener { logEvent(id, "وصل الكادر $crew إلى الموقع") }
        .alertOnFail("تسجيل الوصول")
}

fun signOutStaff(depts: List<String>, crew: String = "") {
    myDisplayName = ""
    try {
        depts.forEach { FirebaseMessaging.getInstance().unsubscribeFromTopic(deptTopic(it)) }
        if (crew.isNotBlank() && depts.isNotEmpty()) FirebaseMessaging.getInstance().unsubscribeFromTopic(crewTopic(depts.first(), crew))
    } catch (e: Exception) { }
    FirebaseAuth.getInstance().signOut()
}

/** تصغير صورة ما بعد الصيانة وتحويلها إلى Base64 */
fun compressImage(ctx: Context, uri: Uri): String {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    var sample = 1
    while (bounds.outWidth / sample > 1600) sample *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sample }
    val bmp = ctx.contentResolver.openInputStream(uri)!!.use { BitmapFactory.decodeStream(it, null, opts) }!!
    // حدّ المستند في Firestore 1MB (يشمل صورة المواطن): نُصغّر الصورة حتى لا تتجاوز ~250KB
    var side = 800f
    var quality = 60
    while (true) {
        val scale = minOf(1f, side / maxOf(bmp.width, bmp.height))
        val scaled = Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true)
        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
        if (out.size() <= 250_000 || side <= 400f) return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        side -= 100f
        quality = maxOf(40, quality - 5)
    }
}

/** إنجاز العمل: يُنهي الشكوى ويُرسل الرد وصورة بعد الصيانة للمواطن والمدير دفعة واحدة */
fun completeWork(id: String, reply: String, afterB64: String, crewMode: Boolean, onResult: (String?) -> Unit) {
    val ts = FieldValue.serverTimestamp()
    // الكادر يرسل الإنجاز لاعتماد القسم؛ موظف القسم ينهيها مباشرة
    val m = mutableMapOf<String, Any>("status" to (if (crewMode) "pending_review" else "resolved"), "reply" to reply, "resolvedAt" to ts, "updatedAt" to ts)
    if (crewMode) { m["submittedAt"] = ts; m["returnNote"] = "" }
    if (afterB64.isNotEmpty()) { m["afterImageB64"] = afterB64; m["afterAt"] = ts }
    FirebaseFirestore.getInstance().collection("complaints").document(id).update(m)
        .addOnSuccessListener { logEvent(id, (if (crewMode) "أنجز العمل وأرسله لاعتماد القسم — " else "أنجز العمل وأرسله للمواطن والمدير — ") + reply); onResult(null) }
        .addOnFailureListener { e ->
            val msg = e.message ?: "خطأ غير معروف"
            onResult(if (msg.contains("PERMISSION_DENIED")) "رُفض الإرسال من الخادم: انشر قواعد Firestore الأحدث (Rules ← Publish) ثم أعد المحاولة"
                     else "فشل الإرسال: $msg")
        }
}

fun sendAfterPhoto(id: String, b64: String) {
    FirebaseFirestore.getInstance().collection("complaints").document(id).update(
        mapOf("afterImageB64" to b64, "afterAt" to FieldValue.serverTimestamp(), "updatedAt" to FieldValue.serverTimestamp())
    )
    logEvent(id, "أضاف صورة بعد الصيانة")
}

fun openMap(ctx: Context, lat: Double, lng: Double) {
    for (u in listOf("geo:$lat,$lng?q=$lat,$lng", "https://www.google.com/maps?q=$lat,$lng")) {
        try {
            ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return
        } catch (e: Exception) { }
    }
}

/** تقرير الموظف للمدير: الفرع المسؤول، هل يمكن صيانتها، والمواد المطلوبة */
fun sendReport(id: String, branch: String, repairable: Boolean, materials: String) {
    FirebaseFirestore.getInstance().collection("complaints").document(id).update(
        mapOf(
            "branch" to branch, "repairable" to repairable,
            "materials" to (if (repairable) materials else ""),
            "assessedAt" to FieldValue.serverTimestamp(), "updatedAt" to FieldValue.serverTimestamp()
        )
    ).addOnSuccessListener {
        logEvent(id, "أرسل تقرير الصيانة: " + (if (repairable) "ممكن صيانتها" else "غير ممكن") +
            (if (branch.isNotBlank()) " (الفرع: $branch)" else "") +
            (if (repairable && materials.isNotBlank()) " — المواد: $materials" else ""))
    }.alertOnFail("حفظ التقرير")
}

/** موظف القسم يحدد الفرع المسؤول دون إرسال تقرير الصيانة (التقرير من اختصاص الكادر) */
fun setBranch(id: String, branch: String) {
    FirebaseFirestore.getInstance().collection("complaints").document(id)
        .update(mapOf("branch" to branch, "updatedAt" to FieldValue.serverTimestamp()))
        .addOnSuccessListener { logEvent(id, "حدّد الفرع المسؤول: $branch") }
        .alertOnFail("حفظ الفرع")
}

/** الفروع: مصفوفة branches، أو نص مفصول بفواصل في branches، أو فرع واحد في الحقل branch */
fun readBranches(doc: DocumentSnapshot): List<String> {
    val raw = doc.get("branches")
    val many: List<String> = when (raw) {
        is List<*> -> raw.mapNotNull { it as? String }
        is String -> raw.split("،", ",", "؛", ";", "\n")
        else -> emptyList()
    }
    return (many + listOfNotNull(doc.getString("branch"))).map { it.trim() }.filter { it.isNotEmpty() }.distinct()
}

/** إسناد الشكوى إلى كادر صيانة ميداني؛ إن كانت جديدة تصبح «قيد المعالجة» */
fun assignCrew(id: String, crew: String, status: String) {
    val m = mutableMapOf<String, Any>(
        "crew" to crew, "crewAt" to FieldValue.serverTimestamp(), "updatedAt" to FieldValue.serverTimestamp(),
        "blockedReason" to ""
    )
    if (status == "routed") m["status"] = "in_progress"
    FirebaseFirestore.getInstance().collection("complaints").document(id).update(m)
        .addOnSuccessListener { logEvent(id, "أسند الشكوى إلى الكادر: $crew") }
        .alertOnFail("إسناد الكادر")
}

/** الكوادر: مصفوفة crews، أو نص مفصول بفواصل في crews، أو كادر واحد في الحقل crew */
fun readCrews(doc: DocumentSnapshot): List<String> {
    val raw = doc.get("crews")
    val many: List<String> = when (raw) {
        is List<*> -> raw.mapNotNull { it as? String }
        is String -> raw.split("،", ",", "؛", ";", "\n")
        else -> emptyList()
    }
    return (many + listOfNotNull(doc.getString("crew"))).map { it.trim() }.filter { it.isNotEmpty() }.distinct()
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        appCtx = applicationContext
        setContent {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                MaterialTheme {
                    var ready by remember { mutableStateOf(FbConfig.init(applicationContext)) }
                    val notifPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
                    LaunchedEffect(Unit) {
                        if (Build.VERSION.SDK_INT >= 33) notifPerm.launch(Manifest.permission.POST_NOTIFICATIONS)
                    }
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
    var branches by remember { mutableStateOf<List<String>>(emptyList()) }
    var crews by remember { mutableStateOf<List<String>>(emptyList()) }
    var crewName by remember { mutableStateOf("") }
    var loaded by remember { mutableStateOf(false) }
    LaunchedEffect(uid) {
        try {
            val doc = FirebaseFirestore.getInstance().collection("staff").document(uid).get().await()
            // يدعم عدة أقسام (الحقل departments مصفوفة) أو قسماً واحداً (الحقل department)
            val arr = (doc.get("departments") as? List<*>)?.mapNotNull { it as? String }?.filter { it.isNotBlank() }
            branches = readBranches(doc)
            crews = readCrews(doc)
            depts = if (!arr.isNullOrEmpty()) arr else doc.getString("department")?.takeIf { it.isNotBlank() }?.let { listOf(it) }
            // كوادر الأقسام المضافة من برنامج الحاسوب (المجموعة deptCrews)
            depts?.forEach { dn ->
                try {
                    val dc = FirebaseFirestore.getInstance().collection("deptCrews").document(deptTopic(dn)).get().await()
                    val extra = (dc.get("crews") as? List<*>)?.mapNotNull { (it as? String)?.trim() }?.filter { it.isNotEmpty() } ?: emptyList()
                    crews = (crews + extra).distinct()
                } catch (e: Exception) { }
            }
            // حساب كادر ميداني: يرى شكاواه المُسندة فقط
            myDisplayName = (doc.getString("name") ?: "").trim()
            if (doc.getString("role") == "crew") crewName = (doc.getString("crew") ?: "").trim()
            if (crewName.isNotBlank()) {
                depts?.firstOrNull()?.let { try { FirebaseMessaging.getInstance().subscribeToTopic(crewTopic(it, crewName)) } catch (e: Exception) { } }
            } else {
                // إشعار فوري عند توجيه شكوى جديدة إلى أقسامه
                depts?.forEach { try { FirebaseMessaging.getInstance().subscribeToTopic(deptTopic(it)) } catch (e: Exception) { } }
            }
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
        else -> Main(d, branches, crews, crewName, email)
    }
}

@Composable
fun Main(depts: List<String>, branches: List<String>, crews: List<String>, crewName: String, email: String) {
    var list by remember { mutableStateOf(listOf<Complaint>()) }
    var tab by remember { mutableIntStateOf(0) }
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }
    val selected = list.firstOrNull { it.id == selectedId }

    var loadErr by remember { mutableStateOf("") }
    DisposableEffect(depts, crewName) {
        // مستمع لكل قسم (وللكادر: شكاواه المُسندة فقط) ثم دمج النتائج
        val parts = mutableMapOf<String, List<Complaint>>()
        val regs = depts.map { d ->
            FirebaseFirestore.getInstance().collection("complaints")
                .whereEqualTo("department", d)
                .let { q -> if (crewName.isNotBlank()) q.whereEqualTo("crew", crewName) else q }
                .addSnapshotListener { s, e ->
                    if (e != null) {
                        loadErr = (e.message ?: "خطأ غير معروف")
                    } else if (s != null) {
                        loadErr = ""
                        parts[d] = s.documents.map { toComplaint(it) }
                        list = parts.values.flatten().sortedWith(
                            compareBy<Complaint>({ if (it.reopenCount > 0 && it.status != "resolved") -1 else priorityRank(it.priority) }).thenByDescending { it.createdMs }
                        )
                    }
                }
        }
        onDispose { regs.forEach { it.remove() } }
    }

    val statuses = listOf("routed", "in_progress", "pending_review", "resolved")
    val labels = listOf("📥" to "الجديدة", "🔧" to "قيد المعالجة", "🔎" to "للاعتماد", "✅" to "المنجزة", "👤" to "حسابي")

    Scaffold(bottomBar = {
        NavigationBar {
            labels.forEachIndexed { i, t ->
                val n = if (i < 4) list.count { it.status == statuses[i] } else 0
                NavigationBarItem(
                    selected = tab == i, onClick = { tab = i },
                    icon = { Text(t.first) },
                    label = { Text(if (i < 4) "${t.second} ($n)" else t.second) }
                )
            }
        }
    }) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            if (tab < 4) {
                val shown = list.filter { it.status == statuses[tab] }
                if (shown.isEmpty()) {
                    Box(Modifier.fillMaxSize().padding(24.dp)) {
                        if (loadErr.isNotBlank()) Text(
                            "تعذّر تحميل الشكاوى: " + (if (loadErr.contains("PERMISSION_DENIED")) "رُفض من الخادم. انشر قواعد Firestore الأحدث (Rules ← Publish)، وتأكد أن مستند حسابك في staff فيه القسم (department) وللكادر role = crew وcrew باسمه." else loadErr),
                            color = MaterialTheme.colorScheme.error
                        ) else Text("لا توجد شكاوى هنا")
                    }
                } else LazyColumn(
                    Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    if (loadErr.isNotBlank()) item { Text("⚠️ تعذّر تحديث الشكاوى: $loadErr", color = MaterialTheme.colorScheme.error) }
                    items(shown, key = { it.id }) { c ->
                        Card(Modifier.fillMaxWidth().clickable { selectedId = c.id }) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(c.title, style = MaterialTheme.typography.titleMedium)
                                Text(if (c.priority == "urgent") "🚨 الأولوية: عاجلة" else "الأولوية: " + priorityAr(c.priority),
                                    color = if (c.priority == "urgent") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
                                if (c.reopenCount > 0 && c.status != "resolved") Text("🔁 أعاد المواطن فتحها (" + c.reopenCount + ")" + (if (c.reopenReason.isNotBlank()) " — " + c.reopenReason else ""), color = MaterialTheme.colorScheme.error)
                                if (c.crew.isNotBlank()) Text("🚧 الكادر: " + c.crew)
                                if (c.returnNote.isNotBlank() && c.status == "in_progress") Text("↩️ أُعيد من القسم: " + c.returnNote, color = MaterialTheme.colorScheme.error)
                                if (c.blockedReason.isNotBlank() && c.crew.isBlank() && c.status != "resolved") Text("🚫 تعذّر على الكادر " + c.blockedBy + ": " + c.blockedReason, color = MaterialTheme.colorScheme.error)
                                Text(stageLine(c), style = MaterialTheme.typography.bodySmall)
                                if (c.repairable == true && c.materials.isNotBlank() && c.status != "resolved" && c.status != "pending_review" && matStatus(c) != "received") Text("📦 المواد: " + matStatusAr(matStatus(c)), color = if (matStatus(c) == "ready") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
                                if (c.dupTitle.isNotBlank()) Text("🔁 مكررة: يوجد بلاغ سابق مماثل", color = MaterialTheme.colorScheme.error)
                                if (c.dupCount > 0) Text("🔁 تكررت " + c.dupCount + " مرة")
                                if (c.lat != null) Text("📍 لها موقع على الخريطة")
                                Text(if (c.summary.isNotBlank()) c.summary else c.text, maxLines = 3)
                            }
                        }
                    }
                }
            } else {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("حسابي", style = MaterialTheme.typography.headlineSmall)
                    if (myDisplayName.isNotBlank()) Text("الاسم: $myDisplayName")
                    Text("البريد: $email")
                    val ctx = androidx.compose.ui.platform.LocalContext.current
                    val ver = remember { try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "" } catch (e: Exception) { "" } }
                    Text("الإصدار: $ver")
                    if (crewName.isNotBlank()) Text("🚧 حساب كادر: $crewName")
                    Text("الأقسام: " + depts.joinToString("، "))
                    Text("عدد الشكاوى الظاهرة لهذا الحساب: ${list.size}")
                    if (loadErr.isNotBlank()) Text("⚠️ $loadErr", color = MaterialTheme.colorScheme.error)
                    if (branches.isNotEmpty()) Text("الفروع: " + branches.joinToString("، "))
                    if (crews.isNotEmpty()) Text("الكوادر: " + crews.joinToString("، "))
                    Button(onClick = { signOutStaff(depts, crewName) }) { Text("تسجيل الخروج") }
                }
            }
        }
    }

    selected?.let { c ->
        val busyCrews = list.filter { it.crew.isNotBlank() && it.status != "resolved" }.groupingBy { it.crew }.eachCount()
        Detail(c, branches, crews, busyCrews, crewName.isNotBlank()) { selectedId = null }
    }
}

@Composable
fun Detail(c: Complaint, branches: List<String>, crews: List<String>, busyCrews: Map<String, Int>, crewMode: Boolean, onClose: () -> Unit) {
    var crew by rememberSaveable(c.id) { mutableStateOf(c.crew) }
    var err by remember { mutableStateOf("") }
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var pendingAfter by rememberSaveable(c.id) { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val pickAfter = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            try { pendingAfter = compressImage(ctx, uri); err = "" } catch (e: Exception) { err = "تعذر قراءة الصورة" }
        }
    }
    val done = c.status == "resolved"
    val pending = c.status == "pending_review"
    var shortNote by rememberSaveable(c.id) { mutableStateOf("") }
    var returnText by rememberSaveable(c.id) { mutableStateOf("") }
    var blockReason by rememberSaveable(c.id) { mutableStateOf("") }
    var showBlock by rememberSaveable(c.id) { mutableStateOf(false) }
    var blocking by remember { mutableStateOf(false) }
    var showDirect by rememberSaveable(c.id) { mutableStateOf(false) }
    // الكادر يكتب تقرير الكشف ويُنجز العمل؛ موظف القسم يسند ويجهّز المواد ويعتمد.
    // وعند عدم وجود كادر مُسنَد يعمل موظف القسم كل شيء بنفسه كما كان.
    val canReport = crewMode || c.crew.isBlank()
    val canComplete = crewMode || c.crew.isBlank() || showDirect
    var history by remember { mutableStateOf(listOf<String>()) }
    DisposableEffect(c.id) {
        val fmt = SimpleDateFormat("MM/dd HH:mm", Locale.US)
        val reg = FirebaseFirestore.getInstance().collection("complaints").document(c.id).collection("log")
            .orderBy("at", Query.Direction.DESCENDING)
            .addSnapshotListener { s, _ ->
                if (s != null) history = s.documents.map {
                    val t = it.getTimestamp("at")?.toDate()?.let { d -> fmt.format(d) } ?: "..."
                    "$t — ${it.getString("by") ?: ""}: ${it.getString("action") ?: ""}"
                }
            }
        onDispose { reg.remove() }
    }
    var reply by rememberSaveable(c.id) { mutableStateOf(c.reply) }
    var branch by rememberSaveable(c.id) { mutableStateOf(c.branch) }
    var repairable by rememberSaveable(c.id) { mutableStateOf(c.repairable) }
    var materials by rememberSaveable(c.id) { mutableStateOf(c.materials) }
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
                Text("الأولوية: " + priorityAr(c.priority))
                if (c.summary.isNotBlank()) Text("ملخص: " + c.summary)
                if (c.crew.isNotBlank()) Text("🚧 مُسندة إلى: " + c.crew)
                if (c.reopenCount > 0) Text("🔁 أعاد المواطن فتح الشكوى (" + c.reopenCount + ")" + (if (c.reopenReason.isNotBlank()) " — السبب: " + c.reopenReason else ""), color = MaterialTheme.colorScheme.error)
                if (c.status == "resolved" && c.confirmed) Text("✔ أكّد المواطن أن المشكلة حُلّت")
                if (c.dupTitle.isNotBlank()) Text("🔁 شكوى مكررة: يوجد بلاغ سابق مماثل («" + c.dupTitle + "»)", color = MaterialTheme.colorScheme.error)
                if (c.dupCount > 0) Text("🔁 تكررت هذه الشكوى " + c.dupCount + " مرة")
                if (c.lat != null && c.lng != null) OutlinedButton(onClick = { openMap(ctx, c.lat, c.lng) }) { Text("📍 فتح موقع الشكوى على الخريطة") }
                if (c.rating > 0) Text("تقييم المواطن: " + "⭐".repeat(c.rating.toInt()))
                if (c.returnNote.isNotBlank() && c.status == "in_progress") Text("↩️ أُعيد إليك من القسم: " + c.returnNote, color = MaterialTheme.colorScheme.error)
                if (c.blockedReason.isNotBlank() && c.crew.isBlank() && c.status != "resolved") Text("🚫 تعذّر على الكادر " + c.blockedBy + ": " + c.blockedReason + " — أسندها لكادر آخر أو اتخذ قراراً", color = MaterialTheme.colorScheme.error)
                Text(stageLine(c), style = MaterialTheme.typography.bodySmall)
                if (c.repairable == true && c.materials.isNotBlank() && c.status != "resolved") {
                    val ms = matStatus(c)
                    Text("📦 المواد المطلوبة: " + c.materials)
                    Text("حالة المواد: " + matStatusAr(ms) + (if (ms == "partial" && c.materialsNote.isNotBlank()) " — الناقص: " + c.materialsNote else ""),
                        color = if (ms == "partial") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
                    if (crewMode) {
                        if (ms == "ready") Button(onClick = { markMaterialsReceived(c.id, c.crew); onClose() }) { Text("📥 استلمت المواد") }
                        else if (ms != "received") Text("⏳ بانتظار تجهيز المواد من القسم")
                    } else if (ms != "ready" && ms != "received" && !pending) {
                        if (ms == "requested") OutlinedButton(onClick = { setMaterialsStatus(c.id, "preparing", ""); onClose() }) { Text("⏳ قيد التجهيز") }
                        OutlinedTextField(shortNote, { shortNote = it }, label = { Text("الناقص من المواد (للنقص الجزئي)") }, modifier = Modifier.fillMaxWidth())
                        OutlinedButton(enabled = shortNote.isNotBlank(), onClick = { setMaterialsStatus(c.id, "partial", shortNote.trim()); onClose() }) { Text("⚠️ نقص جزئي") }
                        Button(onClick = { markMaterialsReady(c.id); onClose() }) { Text("📦 تم تجهيز المواد") }
                    }
                }
                if (c.repairable == false && c.status != "resolved") Text("🚫 التقرير: غير ممكن الصيانة — بانتظار قرار الإدارة", color = MaterialTheme.colorScheme.error)
                Text(c.text)
                if (bmp != null) Image(bitmap = bmp, contentDescription = null, modifier = Modifier.fillMaxWidth())
                if (c.name.isNotBlank() || c.phone.isNotBlank()) Text("المواطن: ${c.name} ${c.phone}")
                if (done) {
                    // بعد الإنجاز: لا خيارات إسناد ولا تقرير صيانة، فقط ما أُنجز
                    Text("✅ العمل المنجز", style = MaterialTheme.typography.titleSmall)
                    if (c.reply.isNotBlank()) Text("ما أُرسل للمواطن والمدير: " + c.reply)
                    val doneImg = remember(c.id, c.afterB64.length) {
                        if (c.afterB64.isEmpty()) null else try {
                            val bb = Base64.decode(c.afterB64, Base64.DEFAULT)
                            BitmapFactory.decodeByteArray(bb, 0, bb.size)?.asImageBitmap()
                        } catch (e: Exception) { null }
                    }
                    if (doneImg != null) {
                        Text("صورة بعد الصيانة")
                        Image(bitmap = doneImg, contentDescription = null, modifier = Modifier.fillMaxWidth())
                    }
                } else if (pending) {
                    // الكادر أرسل الإنجاز: بانتظار اعتماد القسم قبل وصوله للمواطن
                    Text("🔎 بانتظار اعتماد القسم", style = MaterialTheme.typography.titleSmall)
                    if (c.reply.isNotBlank()) Text("ملخص العمل المرسل من الكادر: " + c.reply)
                    val pendImg = remember(c.id, c.afterB64.length) {
                        if (c.afterB64.isEmpty()) null else try {
                            val bb = Base64.decode(c.afterB64, Base64.DEFAULT)
                            BitmapFactory.decodeByteArray(bb, 0, bb.size)?.asImageBitmap()
                        } catch (e: Exception) { null }
                    }
                    if (pendImg != null) {
                        Text("صورة بعد الصيانة")
                        Image(bitmap = pendImg, contentDescription = null, modifier = Modifier.fillMaxWidth())
                    }
                    if (crewMode) {
                        Text("⏳ أُرسل الإنجاز، وسيصل المواطن بعد اعتماد القسم.")
                    } else {
                        Button(onClick = { approveCompletion(c.id); onClose() }) { Text("✅ اعتماد وإرسال للمواطن") }
                        OutlinedTextField(returnText, { returnText = it }, label = { Text("سبب الإرجاع للكادر") }, modifier = Modifier.fillMaxWidth())
                        OutlinedButton(enabled = returnText.isNotBlank(), onClick = { returnToCrew(c.id, returnText.trim()); onClose() }) { Text("↩️ إرجاع للكادر لاستكمال العمل") }
                    }
                } else {
                    if (crewMode) {
                        if (c.arrivedMs > 0) Text("📍 وصلتَ إلى الموقع: " + SimpleDateFormat("MM/dd HH:mm", Locale.US).format(Date(c.arrivedMs)))
                        else Button(onClick = { markArrived(c.id, c.status, c.crew); onClose() }) { Text("📍 وصلت إلى الموقع") }
                        OutlinedButton(onClick = { showBlock = !showBlock }) { Text("🚫 تعذّر العمل") }
                        if (showBlock) {
                            Text("سبب التعذّر (ستعود الشكوى للقسم):", style = MaterialTheme.typography.bodySmall)
                            listOf("الموقع مغلق أو لا يمكن الوصول", "المواطن غير موجود", "يحتاج معدات أو كادراً أكبر", "خارج اختصاص القسم", "أخرى (اكتب التفاصيل في خانة الرد)").forEach { r ->
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    RadioButton(selected = blockReason == r, onClick = { blockReason = r })
                                    Text(r)
                                }
                            }
                            Button(enabled = blockReason.isNotBlank() && !blocking, onClick = {
                                blocking = true
                                val why = blockReason + (if (reply.isNotBlank()) " — " + reply.trim() else "")
                                blockWork(c.id, c.crew, why) { e ->
                                    blocking = false
                                    if (e == null) onClose() else { err = e; android.widget.Toast.makeText(ctx, e, android.widget.Toast.LENGTH_LONG).show() }
                                }
                            }) { Text(if (blocking) "جارٍ الإرسال..." else "إعادة الشكوى للقسم") }
                        }
                    }
                    OutlinedTextField(reply, { reply = it }, label = { Text("رد على المواطن / ملخص العمل المنجز") }, modifier = Modifier.fillMaxWidth())
                    if (crews.isNotEmpty() && !crewMode) {
                        Text("كادر الصيانة الميداني", style = MaterialTheme.typography.titleSmall)
                        crews.forEach { k ->
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { crew = k }) {
                                RadioButton(selected = crew == k, onClick = { crew = k })
                                Text(k + (busyCrews[k]?.let { "  🔴 مشغول ($it)" } ?: "  🟢 متاح"))
                            }
                        }
                        Button(
                            enabled = crew.isNotBlank() && crew != c.crew,
                            onClick = { assignCrew(c.id, crew, c.status); onClose() }
                        ) { Text(if (c.crew.isBlank()) "إسناد للكادر" else "تغيير الكادر") }
                    }
                    Text(if (canReport) "تقرير الصيانة للمدير" else "تقرير الصيانة", style = MaterialTheme.typography.titleSmall)
                    if (!crewMode && branches.isNotEmpty()) {
                        Text("الفرع المسؤول")
                        branches.forEach { b ->
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { branch = b }) {
                                RadioButton(selected = branch == b, onClick = { branch = b })
                                Text(b)
                            }
                        }
                    }
                    if (!canReport) Text("تقرير الكادر: " + (when (c.repairable) { true -> "✅ ممكن صيانتها"; false -> "❌ غير ممكن صيانتها"; else -> "⏳ بانتظار تقرير الكادر" }))
                    if (canReport) {
                    Text("هل يمكن صيانتها؟")
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { repairable = true }) {
                        RadioButton(selected = repairable == true, onClick = { repairable = true })
                        Text("ممكن صيانتها")
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { repairable = false }) {
                        RadioButton(selected = repairable == false, onClick = { repairable = false })
                        Text("غير ممكن")
                    }
                    if (repairable == true) {
                        OutlinedTextField(materials, { materials = it }, label = { Text("المواد المطلوبة للصيانة") }, modifier = Modifier.fillMaxWidth())
                    }
                    }
                    if (canComplete) {
                    Text("الأعمال المنجزة", style = MaterialTheme.typography.titleSmall)
                    Text(if (crewMode) "عند انتهاء العمل أرفق صورة بعد الصيانة (اختياري) ثم أرسل الإنجاز؛ يعتمده القسم ثم يصل المواطن." else "عند انتهاء العمل أرفق صورة بعد الصيانة (اختياري) ثم أرسل الإنجاز للمواطن والمدير.", style = MaterialTheme.typography.bodySmall)
                    val shown = if (pendingAfter.isNotEmpty()) pendingAfter else c.afterB64
                    val aft = remember(shown.length) {
                        if (shown.isEmpty()) null else try {
                            val bb = Base64.decode(shown, Base64.DEFAULT)
                            BitmapFactory.decodeByteArray(bb, 0, bb.size)?.asImageBitmap()
                        } catch (e: Exception) { null }
                    }
                    if (aft != null) Image(bitmap = aft, contentDescription = null, modifier = Modifier.fillMaxWidth())
                    OutlinedButton(onClick = { pickAfter.launch("image/*") }) { Text(if (aft == null) "📷 إرفاق صورة بعد الصيانة" else "📷 استبدال الصورة") }
                    Button(enabled = !sending, onClick = {
                        if (reply.isBlank()) err = "اكتب ملخص العمل المنجز في خانة الرد"
                        else {
                            err = ""; sending = true
                            completeWork(c.id, reply.trim(), pendingAfter, crewMode) { e ->
                                sending = false
                                if (e == null) onClose() else { err = e; android.widget.Toast.makeText(ctx, e, android.widget.Toast.LENGTH_LONG).show() }
                            }
                            scope.launch {
                                delay(20000)
                                if (sending) { sending = false; err = "الاتصال بطيء؛ إن لم يظهر الإنجاز بعد قليل تحقق من الإنترنت" }
                            }
                        }
                    }) { Text(if (sending) "جارٍ الإرسال..." else if (crewMode) "📨 إرسال الإنجاز لاعتماد القسم" else "✅ إرسال الإنجاز للمواطن والمدير") }
                    if (err.isNotBlank()) Text(err, color = MaterialTheme.colorScheme.error)
                    } else if (!crewMode) {
                        OutlinedButton(onClick = { showDirect = true }) { Text("إنهاء مباشر دون الكادر (استثنائي)") }
                    }
                }
                if (err.isNotBlank()) Text(err, color = MaterialTheme.colorScheme.error)
                if (history.isNotEmpty()) {
                    Text("سجل الشكوى", style = MaterialTheme.typography.titleSmall)
                    history.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
                }
            }
        },
        confirmButton = {
            if (done || pending) TextButton(onClick = onClose) { Text("إغلاق") }
            else Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (canReport) Button(onClick = {
                    val r = repairable
                    when {
                        r == null -> err = "اختر: ممكن صيانتها أو غير ممكن"
                        !crewMode && branches.isNotEmpty() && branch.isBlank() -> err = "اختر الفرع المسؤول"
                        r && materials.isBlank() -> err = "اكتب المواد المطلوبة للصيانة"
                        else -> { sendReport(c.id, branch, r, materials.trim()); onClose() }
                    }
                }) { Text("إرسال التقرير للمدير") }
                else if (branches.isNotEmpty()) OutlinedButton(enabled = branch.isNotBlank() && branch != c.branch, onClick = { setBranch(c.id, branch); onClose() }) { Text("حفظ الفرع") }
                if (c.status == "routed" && !crewMode) Button(onClick = { setStatus(c.id, "in_progress", reply); onClose() }) { Text("بدء المعالجة") }
            }
        },
        dismissButton = { if (!done && !pending) TextButton(onClick = onClose) { Text("إغلاق") } }
    )
}
