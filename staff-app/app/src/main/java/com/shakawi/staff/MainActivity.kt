package com.shakawi.staff

import android.graphics.BitmapFactory
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
    val branch: String, val repairable: Boolean?, val materials: String, val crew: String
)

fun toComplaint(d: DocumentSnapshot) = Complaint(
    d.id, d.getString("title") ?: "", d.getString("text") ?: "",
    d.getString("department") ?: "", d.getString("priority") ?: "",
    d.getString("aiSummary") ?: "", d.getString("status") ?: "new",
    d.getString("reply") ?: "",
    d.getTimestamp("createdAt")?.toDate()?.time ?: 0L,
    d.getString("imageB64") ?: "", d.getString("name") ?: "", d.getString("phone") ?: "",
    d.getString("branch") ?: "", d.getBoolean("repairable"), d.getString("materials") ?: "",
    d.getString("crew") ?: ""
)

fun priorityAr(p: String): String = when (p) {
    "urgent" -> "عاجلة"
    "high" -> "عالية"
    "medium" -> "متوسطة"
    "low" -> "منخفضة"
    else -> "-"
}

fun setStatus(id: String, status: String, reply: String) {
    FirebaseFirestore.getInstance().collection("complaints").document(id).update(
        mapOf("status" to status, "reply" to reply, "updatedAt" to FieldValue.serverTimestamp())
    )
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
                                if (c.crew.isNotBlank()) Text("🚧 الكادر: " + c.crew)
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
                    Button(onClick = { FirebaseAuth.getInstance().signOut() }) { Text("تسجيل الخروج") }
                }
            }
        }
    }

    selected?.let { c ->
        Detail(c, branches, crews) { selected = null }
    }
}

@Composable
fun Detail(c: Complaint, branches: List<String>, crews: List<String>, onClose: () -> Unit) {
    var crew by remember { mutableStateOf(c.crew) }
    var reply by remember { mutableStateOf(c.reply) }
    var branch by remember { mutableStateOf(c.branch) }
    var repairable by remember { mutableStateOf(c.repairable) }
    var materials by remember { mutableStateOf(c.materials) }
    var err by remember { mutableStateOf("") }
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
                Text(c.text)
                if (bmp != null) Image(bitmap = bmp, contentDescription = null, modifier = Modifier.fillMaxWidth())
                if (c.name.isNotBlank() || c.phone.isNotBlank()) Text("المواطن: ${c.name} ${c.phone}")
                OutlinedTextField(reply, { reply = it }, label = { Text("الرد على المواطن") }, modifier = Modifier.fillMaxWidth())
                if (crews.isNotEmpty()) {
                    Text("كادر الصيانة الميداني", style = MaterialTheme.typography.titleSmall)
                    crews.forEach { k ->
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { crew = k }) {
                            RadioButton(selected = crew == k, onClick = { crew = k })
                            Text(k)
                        }
                    }
                    if (c.status != "resolved") Button(
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
                if (err.isNotBlank()) Text(err, color = MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = {
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = {
                    val r = repairable
                    when {
                        r == null -> err = "اختر: ممكن صيانتها أو غير ممكن"
                        branches.isNotEmpty() && branch.isBlank() -> err = "اختر الفرع المسؤول"
                        r && materials.isBlank() -> err = "اكتب المواد المطلوبة للصيانة"
                        else -> { sendReport(c.id, branch, r, materials.trim()); onClose() }
                    }
                }) { Text("إرسال التقرير للمدير") }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (c.status == "routed") Button(onClick = { setStatus(c.id, "in_progress", reply); onClose() }) { Text("بدء المعالجة") }
                    if (c.status != "resolved") Button(onClick = { setStatus(c.id, "resolved", reply); onClose() }) { Text("تم الحل") }
                }
            }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("إغلاق") } }
    )
}
