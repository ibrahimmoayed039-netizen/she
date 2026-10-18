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
    val dupCount: Long, val rating: Long
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
    d.getString("dupTitle") ?: "", d.getLong("dupCount") ?: 0L, d.getLong("rating") ?: 0L
)

fun priorityAr(p: String): String = when (p) {
    "urgent" -> "عاجلة"
    "high" -> "عالية"
    "medium" -> "متوسطة"
    "low" -> "منخفضة"
    else -> "-"
}

/** سجل الشكوى: من فعل ماذا ومتى (مجموعة فرعية log داخل الشكوى) */
fun logEvent(id: String, action: String) {
    val by = FirebaseAuth.getInstance().currentUser?.email ?: "موظف"
    FirebaseFirestore.getInstance().collection("complaints").document(id).collection("log")
        .add(mapOf("by" to by, "action" to action, "at" to FieldValue.serverTimestamp()))
}

/** الأكثر إلحاحاً أولاً */
fun priorityRank(p: String): Int = when (p) { "urgent" -> 0; "high" -> 1; "medium" -> 2; "low" -> 3; else -> 4 }

fun setStatus(id: String, status: String, reply: String) {
    val m = mutableMapOf<String, Any>("status" to status, "reply" to reply, "updatedAt" to FieldValue.serverTimestamp())
    if (status == "in_progress") m["startedAt"] = FieldValue.serverTimestamp()
    if (status == "resolved") m["resolvedAt"] = FieldValue.serverTimestamp()
    FirebaseFirestore.getInstance().collection("complaints").document(id).update(m)
    logEvent(id, (if (status == "resolved") "أنهى الشكوى (تم الحل)" else "بدأ المعالجة") +
        (if (reply.isNotBlank()) " — الرد: $reply" else ""))
}

/** اسم موضوع الإشعارات للقسم (ترميز سداسي لأن الأسماء العربية غير مسموحة في أسماء المواضيع) */
fun deptTopic(d: String) = "d" + d.toByteArray(Charsets.UTF_8).joinToString("") { "%02x".format(it) }

fun signOutStaff(depts: List<String>) {
    try { depts.forEach { FirebaseMessaging.getInstance().unsubscribeFromTopic(deptTopic(it)) } } catch (e: Exception) { }
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
    val scale = minOf(1f, 800f / maxOf(bmp.width, bmp.height))
    val scaled = Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true)
    val out = ByteArrayOutputStream()
    scaled.compress(Bitmap.CompressFormat.JPEG, 60, out)
    return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
}

/** إنجاز العمل: يُنهي الشكوى ويُرسل الرد وصورة بعد الصيانة للمواطن والمدير دفعة واحدة */
fun completeWork(id: String, reply: String, afterB64: String) {
    val ts = FieldValue.serverTimestamp()
    val m = mutableMapOf<String, Any>("status" to "resolved", "reply" to reply, "resolvedAt" to ts, "updatedAt" to ts)
    if (afterB64.isNotEmpty()) { m["afterImageB64"] = afterB64; m["afterAt"] = ts }
    FirebaseFirestore.getInstance().collection("complaints").document(id).update(m)
    logEvent(id, "أنجز العمل وأرسله للمواطن والمدير — $reply")
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
    )
    logEvent(id, "أرسل تقرير الصيانة: " + (if (repairable) "ممكن صيانتها" else "غير ممكن") +
        (if (branch.isNotBlank()) " (الفرع: $branch)" else "") +
        (if (repairable && materials.isNotBlank()) " — المواد: $materials" else ""))
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
        "crew" to crew, "crewAt" to FieldValue.serverTimestamp(), "updatedAt" to FieldValue.serverTimestamp()
    )
    if (status == "routed") m["status"] = "in_progress"
    FirebaseFirestore.getInstance().collection("complaints").document(id).update(m)
    logEvent(id, "أسند الشكوى إلى الكادر: $crew")
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
    var loaded by remember { mutableStateOf(false) }
    LaunchedEffect(uid) {
        try {
            val doc = FirebaseFirestore.getInstance().collection("staff").document(uid).get().await()
            // يدعم عدة أقسام (الحقل departments مصفوفة) أو قسماً واحداً (الحقل department)
            val arr = (doc.get("departments") as? List<*>)?.mapNotNull { it as? String }?.filter { it.isNotBlank() }
            branches = readBranches(doc)
            crews = readCrews(doc)
            depts = if (!arr.isNullOrEmpty()) arr else doc.getString("department")?.takeIf { it.isNotBlank() }?.let { listOf(it) }
            // إشعار فوري عند توجيه شكوى جديدة إلى أقسامه
            depts?.forEach { try { FirebaseMessaging.getInstance().subscribeToTopic(deptTopic(it)) } catch (e: Exception) { } }
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
        else -> Main(d, branches, crews, email)
    }
}

@Composable
fun Main(depts: List<String>, branches: List<String>, crews: List<String>, email: String) {
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
                        list = parts.values.flatten().sortedWith(
                            compareBy<Complaint>({ priorityRank(it.priority) }).thenByDescending { it.createdMs }
                        )
                    }
                }
        }
        onDispose { regs.forEach { it.remove() } }
    }

    val statuses = listOf("routed", "in_progress", "resolved")
    val labels = listOf("📥" to "الجديدة", "🔧" to "قيد المعالجة", "✅" to "المنجزة", "👤" to "حسابي")

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
                                Text(if (c.priority == "urgent") "🚨 الأولوية: عاجلة" else "الأولوية: " + priorityAr(c.priority),
                                    color = if (c.priority == "urgent") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
                                if (c.crew.isNotBlank()) Text("🚧 الكادر: " + c.crew)
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
                    Text("البريد: $email")
                    val ctx = androidx.compose.ui.platform.LocalContext.current
                    val ver = remember { try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "" } catch (e: Exception) { "" } }
                    Text("الإصدار: $ver")
                    Text("الأقسام: " + depts.joinToString("، "))
                    if (branches.isNotEmpty()) Text("الفروع: " + branches.joinToString("، "))
                    if (crews.isNotEmpty()) Text("الكوادر: " + crews.joinToString("، "))
                    Button(onClick = { signOutStaff(depts) }) { Text("تسجيل الخروج") }
                }
            }
        }
    }

    selected?.let { c ->
        val busyCrews = list.filter { it.crew.isNotBlank() && it.status != "resolved" }.groupingBy { it.crew }.eachCount()
        Detail(c, branches, crews, busyCrews) { selected = null }
    }
}

@Composable
fun Detail(c: Complaint, branches: List<String>, crews: List<String>, busyCrews: Map<String, Int>, onClose: () -> Unit) {
    var crew by remember { mutableStateOf(c.crew) }
    var err by remember { mutableStateOf("") }
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var pendingAfter by remember { mutableStateOf("") }
    val pickAfter = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            try { pendingAfter = compressImage(ctx, uri); err = "" } catch (e: Exception) { err = "تعذر قراءة الصورة" }
        }
    }
    val done = c.status == "resolved"
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
    var reply by remember { mutableStateOf(c.reply) }
    var branch by remember { mutableStateOf(c.branch) }
    var repairable by remember { mutableStateOf(c.repairable) }
    var materials by remember { mutableStateOf(c.materials) }
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
                if (c.dupTitle.isNotBlank()) Text("🔁 شكوى مكررة: يوجد بلاغ سابق مماثل («" + c.dupTitle + "»)", color = MaterialTheme.colorScheme.error)
                if (c.dupCount > 0) Text("🔁 تكررت هذه الشكوى " + c.dupCount + " مرة")
                if (c.lat != null && c.lng != null) OutlinedButton(onClick = { openMap(ctx, c.lat, c.lng) }) { Text("📍 فتح موقع الشكوى على الخريطة") }
                if (c.rating > 0) Text("تقييم المواطن: " + "⭐".repeat(c.rating.toInt()))
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
                } else {
                    OutlinedTextField(reply, { reply = it }, label = { Text("رد على المواطن / ملخص العمل المنجز") }, modifier = Modifier.fillMaxWidth())
                    if (crews.isNotEmpty()) {
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
                    Text("تقرير الصيانة للمدير", style = MaterialTheme.typography.titleSmall)
                    if (branches.isNotEmpty()) {
                        Text("الفرع المسؤول")
                        branches.forEach { b ->
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { branch = b }) {
                                RadioButton(selected = branch == b, onClick = { branch = b })
                                Text(b)
                            }
                        }
                    }
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
                    Text("الأعمال المنجزة", style = MaterialTheme.typography.titleSmall)
                    Text("عند انتهاء العمل أرفق صورة بعد الصيانة (اختياري) ثم أرسل الإنجاز للمواطن والمدير.", style = MaterialTheme.typography.bodySmall)
                    val shown = if (pendingAfter.isNotEmpty()) pendingAfter else c.afterB64
                    val aft = remember(shown.length) {
                        if (shown.isEmpty()) null else try {
                            val bb = Base64.decode(shown, Base64.DEFAULT)
                            BitmapFactory.decodeByteArray(bb, 0, bb.size)?.asImageBitmap()
                        } catch (e: Exception) { null }
                    }
                    if (aft != null) Image(bitmap = aft, contentDescription = null, modifier = Modifier.fillMaxWidth())
                    OutlinedButton(onClick = { pickAfter.launch("image/*") }) { Text(if (aft == null) "📷 إرفاق صورة بعد الصيانة" else "📷 استبدال الصورة") }
                    Button(onClick = {
                        if (reply.isBlank()) err = "اكتب ملخص العمل المنجز في خانة الرد"
                        else { completeWork(c.id, reply.trim(), pendingAfter); onClose() }
                    }) { Text("✅ إرسال الإنجاز للمواطن والمدير") }
                }
                if (err.isNotBlank()) Text(err, color = MaterialTheme.colorScheme.error)
                if (history.isNotEmpty()) {
                    Text("سجل الشكوى", style = MaterialTheme.typography.titleSmall)
                    history.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
                }
            }
        },
        confirmButton = {
            if (done) TextButton(onClick = onClose) { Text("إغلاق") }
            else Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = {
                    val r = repairable
                    when {
                        r == null -> err = "اختر: ممكن صيانتها أو غير ممكن"
                        branches.isNotEmpty() && branch.isBlank() -> err = "اختر الفرع المسؤول"
                        r && materials.isBlank() -> err = "اكتب المواد المطلوبة للصيانة"
                        else -> { sendReport(c.id, branch, r, materials.trim()); onClose() }
                    }
                }) { Text("إرسال التقرير للمدير") }
                if (c.status == "routed") Button(onClick = { setStatus(c.id, "in_progress", reply); onClose() }) { Text("بدء المعالجة") }
            }
        },
        dismissButton = { if (!done) TextButton(onClick = onClose) { Text("إغلاق") } }
    )
}
