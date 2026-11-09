package com.shakawi.citizen

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.delay
import java.io.File
import java.util.Locale

/** أقصى مدة للرسالة الصوتية بالثواني. بترميز AAC أحادي 24kbps تبقى حول 180KB فتتسع مع الصورة داخل مستند Firestore (حد 1MB) */
const val VOICE_MAX_SEC = 60

fun fmtSec(s: Int): String = String.format(Locale.US, "%d:%02d", s / 60, s % 60)

/** ملف مؤقت لتشغيل رسالة صوتية مخزنة كنص Base64 */
fun voiceFileFromB64(ctx: Context, id: String, b64: String): File {
    val f = File(ctx.cacheDir, "voice_" + id.filter { it.isLetterOrDigit() } + "_" + b64.length + ".m4a")
    if (!f.exists()) f.writeBytes(Base64.decode(b64, Base64.DEFAULT))
    return f
}

private val WaveBars = listOf(8, 14, 22, 12, 26, 18, 10, 24, 16, 28, 12, 20, 9, 22, 14, 26, 11, 17)

/** مشغّل رسالة صوتية: كرة تشغيل مجسمة وموجة صوت تتلوّن أثناء التشغيل */
@Composable
fun VoicePlayer(file: File, sec: Int, modifier: Modifier = Modifier) {
    var playing by remember(file) { mutableStateOf(false) }
    var player by remember(file) { mutableStateOf<MediaPlayer?>(null) }
    DisposableEffect(file) {
        onDispose {
            try { player?.release() } catch (e: Exception) { }
            player = null
        }
    }
    fun toggle() {
        val cur = player
        if (playing && cur != null) {
            try { cur.pause() } catch (e: Exception) { }
            playing = false
            return
        }
        try {
            val p = cur ?: MediaPlayer().apply {
                setDataSource(file.absolutePath)
                prepare()
                setOnCompletionListener { playing = false; seekTo(0) }
            }
            player = p
            p.start()
            playing = true
        } catch (e: Exception) {
            playing = false
        }
    }
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Orb(46.dp, Sk.TealLight, Sk.TealDeep, Modifier.clickable { toggle() }) {
            Text(if (playing) "⏸" else "▶", color = Color.White, fontSize = 18.sp)
        }
        Row(Modifier.weight(1f).height(30.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            WaveBars.forEach { bar ->
                Box(Modifier.width(4.dp).height(bar.dp).clip(RoundedCornerShape(2.dp)).background(if (playing) Sk.Teal else Sk.Edge))
            }
        }
        Text(fmtSec(sec), style = MaterialTheme.typography.labelMedium, color = Sk.Muted)
    }
}

class VoiceRecorder(private val ctx: Context) {
    private var rec: MediaRecorder? = null
    var file: File? = null
        private set
    val isRecording: Boolean get() = rec != null

    @Suppress("DEPRECATION")
    private fun newRecorder(): MediaRecorder =
        if (Build.VERSION.SDK_INT >= 31) MediaRecorder(ctx) else MediaRecorder()

    fun start(): Boolean {
        return try {
            val f = File(ctx.cacheDir, "voice_" + System.currentTimeMillis() + ".m4a")
            val r = newRecorder()
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioChannels(1)
            r.setAudioSamplingRate(16000)
            r.setAudioEncodingBitRate(24000)
            r.setMaxDuration((VOICE_MAX_SEC + 2) * 1000)
            r.setOutputFile(f.absolutePath)
            r.prepare()
            r.start()
            rec = r
            file = f
            true
        } catch (e: Exception) {
            try { rec?.release() } catch (x: Exception) { }
            rec = null
            false
        }
    }

    /** يوقف التسجيل. يُرجع false إن كان قصيراً جداً أو فشل (ويحذف الملف) */
    fun stop(): Boolean {
        val r = rec ?: return false
        rec = null
        var ok = true
        try { r.stop() } catch (e: Exception) { ok = false }
        try { r.release() } catch (e: Exception) { }
        if (!ok) { file?.delete(); file = null }
        return ok
    }

    fun cancel() {
        stop()
        file?.delete()
        file = null
    }
}

/** بطاقة تسجيل رسالة صوتية: زر تسجيل ← مؤقت وإيقاف ← مشغّل مع حذف */
@Composable
fun VoiceRecorderCard(
    file: File?, sec: Int, onResult: (File?, Int) -> Unit,
    modifier: Modifier = Modifier, onRecording: (Boolean) -> Unit = {}
) {
    val ctx = LocalContext.current
    val recorder = remember { VoiceRecorder(ctx) }
    var recording by remember { mutableStateOf(false) }
    var elapsed by remember { mutableIntStateOf(0) }
    var err by remember { mutableStateOf("") }
    DisposableEffect(Unit) {
        onDispose { if (recorder.isRecording) recorder.cancel() }
    }
    fun finish() {
        recording = false
        onRecording(false)
        val ok = recorder.stop()
        val f = recorder.file
        if (ok && f != null && elapsed >= 1) onResult(f, elapsed)
        else { f?.delete(); err = "التسجيل قصير جداً، حاول مرة أخرى" }
    }
    fun begin() {
        err = ""
        if (recorder.start()) { elapsed = 0; recording = true; onRecording(true) }
        else err = "تعذّر بدء التسجيل"
    }
    val perm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) begin() else err = "اسمح باستخدام الميكروفون من إعدادات الهاتف لتسجيل رسالة صوتية"
    }
    LaunchedEffect(recording) {
        while (recording) {
            delay(1000)
            if (!recording) break
            elapsed += 1
            if (elapsed >= VOICE_MAX_SEC) finish()
        }
    }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        when {
            recording -> DepthCard(Modifier.fillMaxWidth(), accent = Sk.Coral) {
                Row(
                    Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Orb(40.dp, Color(0xFFFF8A80), Sk.Coral) { Text("●", color = Color.White, fontSize = 16.sp) }
                    Column(Modifier.weight(1f)) {
                        Text("جارٍ التسجيل...", style = MaterialTheme.typography.titleSmall)
                        Text(fmtSec(elapsed) + " / " + fmtSec(VOICE_MAX_SEC), style = MaterialTheme.typography.bodySmall, color = Sk.Muted)
                    }
                    DepthButton(onClick = { finish() }) { Text("⏹ إيقاف") }
                }
            }
            file != null -> DepthCard(Modifier.fillMaxWidth(), accent = Sk.Teal) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("🎙️ رسالة صوتية مرفقة", style = MaterialTheme.typography.titleSmall)
                    VoicePlayer(file, sec)
                    LinkButton(onClick = { file.delete(); onResult(null, 0) }) { Text("🗑 حذف التسجيل") }
                }
            }
            else -> GhostButton(
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) begin()
                    else perm.launch(Manifest.permission.RECORD_AUDIO)
                }
            ) { Text("🎙️ تسجيل رسالة صوتية (حتى دقيقة)") }
        }
        if (err.isNotBlank()) Alert(err)
    }
}
