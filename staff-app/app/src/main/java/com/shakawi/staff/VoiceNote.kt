package com.shakawi.staff

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
