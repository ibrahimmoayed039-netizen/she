package com.shakawi.citizen

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/*
 * نظام التصميم «لوحة المدينة»: واجهة مجسّمة مستوحاة من لوحات الطرق واللوحات المطلية.
 *  - أسطح بارزة بحواف مشطوفة وظلال طبقية (DepthCard / plate)
 *  - أزرار بمفاتيح ملموسة تنخفض عند الضغط (DepthButton / GhostButton)
 *  - حقول غائرة (DepthField) وشريط تنقل عائم (DepthDock)
 *  - مؤشر تتبّع بكرات ثلاثية الأبعاد على أنبوب (Tracker)
 * لا يعتمد على خطوط أو أيقونات خارجية، ويعمل بالمكتبات الموجودة فقط.
 */

object Sk {
    val Ink = Color(0xFF0C2A33)
    val Ink2 = Color(0xFF184350)
    val Teal = Color(0xFF0C838C)
    val TealLight = Color(0xFF2DBBC0)
    val TealDeep = Color(0xFF076871)
    val Amber = Color(0xFFFFB300)
    val AmberLight = Color(0xFFFFD35F)
    val AmberLip = Color(0xFFB87800)
    val Coral = Color(0xFFE0483E)
    val CoralSoft = Color(0xFFFDE7E4)
    val Green = Color(0xFF168457)
    val Orange = Color(0xFFF08A24)
    val Slate = Color(0xFF55737D)
    val Bg1 = Color(0xFFEEF4F5)
    val Bg2 = Color(0xFFD6E2E6)
    val PlateLow = Color(0xFFEDF3F5)
    val Edge = Color(0xFFC2D2D7)
    val Muted = Color(0xFF557079)
}

/** ألوان هوية هذا التطبيق (القرص المعدني في الشعار) */
object Brand {
    val rimHi = Color(0xFFF6FCFD)
    val rimLo = Color(0xFF86AEB6)
    val faceHi = Sk.TealLight
    val faceMid = Sk.Teal
    val faceLo = Sk.TealDeep
}

/** خط التطبيق. لتغييره إلى «شهرزاد الجديد» بدّل AmiriFont بـ ScheherazadeFont في AppFont */
val AmiriFont = FontFamily(
    Font(R.font.amiri_regular, FontWeight.Normal),
    Font(R.font.amiri_bold, FontWeight.Bold),
)
val ScheherazadeFont = FontFamily(
    Font(R.font.scheherazade_regular, FontWeight.Normal),
    Font(R.font.scheherazade_bold, FontWeight.Bold),
)
val AppFont = AmiriFont

/** حجم الخط العربي النسخي أصغر بصرياً من السان سيريف، لذلك تُكبَّر كل الأحجام بهذا المعامل (1.0 = بلا تكبير) */
private const val FontScale = 1.12f

private fun ts(size: Int, w: FontWeight, lh: Int) = TextStyle(
    fontFamily = AppFont, fontWeight = w, fontSize = (size * FontScale).sp, lineHeight = (lh * FontScale).sp,
    letterSpacing = 0.sp // التباعد بين الأحرف يقطع اتصال الحروف العربية، لذلك يُصفَّر
)

val SkType = Typography(
    headlineSmall = ts(23, FontWeight.ExtraBold, 32),
    titleLarge = ts(20, FontWeight.ExtraBold, 28),
    titleMedium = ts(17, FontWeight.Bold, 25),
    titleSmall = ts(14, FontWeight.Bold, 21),
    bodyLarge = ts(16, FontWeight.Normal, 25),
    bodyMedium = ts(14, FontWeight.Normal, 22),
    bodySmall = ts(12, FontWeight.Normal, 18),
    labelLarge = ts(15, FontWeight.Bold, 20),
    labelMedium = ts(12, FontWeight.Bold, 16),
    labelSmall = ts(10, FontWeight.Bold, 14),
)

private val SkShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(18.dp),
    large = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(30.dp),
)

private val SkColors = lightColorScheme(
    primary = Sk.Teal, onPrimary = Color.White,
    primaryContainer = Color(0xFFCFEEF0), onPrimaryContainer = Sk.Ink,
    secondary = Sk.Amber, onSecondary = Sk.Ink,
    secondaryContainer = Color(0xFFFFE9B0), onSecondaryContainer = Sk.Ink,
    tertiary = Sk.Ink2, onTertiary = Color.White,
    background = Color.Transparent, onBackground = Sk.Ink,
    surface = Color.White, onSurface = Sk.Ink,
    surfaceVariant = Color(0xFFDCE7EA), onSurfaceVariant = Sk.Muted,
    outline = Sk.Edge, outlineVariant = Color(0xFFD5E1E4),
    error = Sk.Coral, onError = Color.White,
    errorContainer = Sk.CoralSoft, onErrorContainer = Color(0xFF7A1D17),
    surfaceContainerHigh = Color(0xFFF8FBFC),
)

fun Modifier.appBackground(): Modifier = this.drawBehind {
    drawRect(Brush.verticalGradient(listOf(Sk.Bg1, Sk.Bg2)))
    val c1 = Offset(size.width * 0.95f, size.height * 0.03f)
    drawCircle(
        Brush.radialGradient(listOf(Sk.TealLight.copy(alpha = 0.24f), Color.Transparent), center = c1, radius = size.width * 0.8f),
        radius = size.width * 0.8f, center = c1
    )
    val c2 = Offset(size.width * 0.02f, size.height * 0.98f)
    drawCircle(
        Brush.radialGradient(listOf(Sk.Amber.copy(alpha = 0.16f), Color.Transparent), center = c2, radius = size.width * 0.75f),
        radius = size.width * 0.75f, center = c2
    )
}

@Composable
fun ShakawiTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = SkColors, typography = SkType, shapes = SkShapes) {
        CompositionLocalProvider(LocalContentColor provides Sk.Ink) {
            Box(Modifier.fillMaxSize().appBackground()) { content() }
        }
    }
}

/** سطح بارز: ظل طبقي + تدرّج + حافة مشطوفة (ضوء من الأعلى وظل من الأسفل) */
fun Modifier.plate(shape: Shape, elevation: Dp = 12.dp): Modifier = this
    .shadow(elevation, shape, ambientColor = Sk.Ink.copy(alpha = 0.20f), spotColor = Sk.Ink.copy(alpha = 0.34f))
    .clip(shape)
    .background(Brush.verticalGradient(listOf(Color.White, Sk.PlateLow)))
    .border(1.dp, Brush.verticalGradient(listOf(Color.White, Sk.Edge)), shape)

/** شعار التطبيق: قرص معدني ببالون شكوى وعلامة صح */
@Composable
fun Medallion(d: Dp = 56.dp, modifier: Modifier = Modifier) {
    Canvas(
        modifier.size(d).shadow(d / 6, CircleShape, ambientColor = Sk.Ink.copy(alpha = 0.3f), spotColor = Sk.Ink.copy(alpha = 0.5f))
    ) {
        val s = this.size.minDimension
        val u = s / 100f
        drawCircle(
            Brush.linearGradient(listOf(Brand.rimHi, Brand.rimLo), start = Offset(0f, 0f), end = Offset(s, s)),
            radius = 50f * u
        )
        drawCircle(
            Brush.radialGradient(listOf(Brand.faceHi, Brand.faceMid, Brand.faceLo), center = Offset(35f * u, 28f * u), radius = 72f * u),
            radius = 43f * u
        )
        drawCircle(
            Brush.linearGradient(listOf(Color.White.copy(alpha = 0.55f), Color.Black.copy(alpha = 0.28f)), start = Offset(0f, 0f), end = Offset(s, s)),
            radius = 43f * u, style = Stroke(width = 1.6f * u)
        )
        val bubble = Path().apply {
            addRoundRect(RoundRect(26f * u, 28f * u, 74f * u, 62f * u, CornerRadius(11f * u, 11f * u)))
            moveTo(60f * u, 61f * u); lineTo(73f * u, 61f * u); lineTo(71f * u, 76f * u); close()
        }
        translate(0f, 2.6f * u) { drawPath(bubble, Color.Black.copy(alpha = 0.28f)) }
        drawPath(bubble, Brush.verticalGradient(listOf(Color.White, Color(0xFFD3E4E8)), startY = 28f * u, endY = 76f * u))
        val chk = Path().apply { moveTo(38f * u, 46f * u); lineTo(46.5f * u, 54f * u); lineTo(62f * u, 37.5f * u) }
        drawPath(
            chk, Brush.verticalGradient(listOf(Sk.AmberLight, Sk.Amber), startY = 37f * u, endY = 54f * u),
            style = Stroke(width = 6.5f * u, cap = StrokeCap.Round, join = StrokeJoin.Round)
        )
    }
}

/** كرة ثلاثية الأبعاد (تدرّج شعاعي + لمعة + ظل) */
@Composable
fun Orb(d: Dp, hi: Color, lo: Color, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit = {}) {
    Box(
        modifier.size(d)
            .shadow(d / 4, CircleShape, ambientColor = lo.copy(alpha = 0.55f), spotColor = lo.copy(alpha = 0.85f))
            .clip(CircleShape)
            .drawBehind {
                drawCircle(Brush.radialGradient(listOf(hi, lo), center = Offset(size.width * 0.34f, size.height * 0.28f), radius = size.minDimension * 0.85f))
                drawCircle(
                    Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.55f), Color.Transparent), endY = size.height * 0.5f),
                    radius = size.minDimension * 0.34f, center = Offset(size.width * 0.38f, size.height * 0.28f)
                )
            },
        contentAlignment = Alignment.Center, content = content
    )
}

@Composable
fun DepthCard(
    modifier: Modifier = Modifier,
    accent: Color? = null,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit
) {
    val shape = RoundedCornerShape(22.dp)
    val base = modifier.plate(shape)
    val m = if (onClick != null) base.clickable(onClick = onClick) else base
    Row(m.height(IntrinsicSize.Min)) {
        if (accent != null) {
            Box(
                Modifier.width(9.dp).fillMaxHeight()
                    .background(Brush.horizontalGradient(listOf(lerp(accent, Color.White, 0.28f), accent)))
            )
        }
        Column(Modifier.weight(1f), content = content)
    }
}

@Composable
private fun KeyFace(
    onClick: () -> Unit, modifier: Modifier, enabled: Boolean,
    top: Color, bottom: Color, lip: Color, rim: Color, fg: Color,
    content: @Composable RowScope.() -> Unit
) {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val lipH = 5.dp
    val dip by animateDpAsState(if (pressed && enabled) lipH else 0.dp, animationSpec = tween(70))
    val shape = RoundedCornerShape(18.dp)
    Box(
        modifier.clickable(interactionSource = src, indication = null, enabled = enabled, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        // الحافة السفلية (سماكة المفتاح)
        Box(
            Modifier.matchParentSize().padding(top = lipH)
                .then(if (pressed || !enabled) Modifier else Modifier.shadow(8.dp, shape, ambientColor = lip, spotColor = lip))
                .background(lip, shape)
        )
        // وجه المفتاح
        Box(
            Modifier.matchParentSize().padding(bottom = lipH).offset(y = dip)
                .clip(shape)
                .background(Brush.verticalGradient(listOf(top, bottom)))
                .drawBehind {
                    drawRect(
                        Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.34f), Color.Transparent), endY = size.height * 0.55f),
                        size = Size(size.width, size.height * 0.55f)
                    )
                }
                .border(1.dp, Brush.verticalGradient(listOf(rim, Color.Transparent)), shape)
        )
        Row(
            Modifier.offset(y = dip).padding(horizontal = 20.dp).padding(bottom = lipH).heightIn(min = 52.dp),
            horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically
        ) {
            CompositionLocalProvider(LocalContentColor provides fg) {
                ProvideTextStyle(SkType.labelLarge) { content() }
            }
        }
    }
}

/** الزر الرئيسي: مفتاح كهرماني لامع بلون إشارات الطرق */
@Composable
fun DepthButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, content: @Composable RowScope.() -> Unit) {
    if (enabled) KeyFace(onClick, modifier, true, Sk.AmberLight, Sk.Amber, Sk.AmberLip, Color.White.copy(alpha = 0.8f), Sk.Ink, content)
    else KeyFace(onClick, modifier, false, Color(0xFFDCE5E8), Color(0xFFC9D5D9), Color(0xFFAEBCC1), Color.White.copy(alpha = 0.6f), Sk.Muted, content)
}

/** الزر الثانوي: لوحة بيضاء بارزة */
@Composable
fun GhostButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, content: @Composable RowScope.() -> Unit) {
    if (enabled) KeyFace(onClick, modifier, true, Color.White, Color(0xFFE6EEF0), Color(0xFFB4C6CC), Color.White, Sk.TealDeep, content)
    else KeyFace(onClick, modifier, false, Color(0xFFF1F5F6), Color(0xFFE3EAEC), Color(0xFFC9D5D9), Color.White, Color(0xFF93A8AE), content)
}

@Composable
fun LinkButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, content: @Composable RowScope.() -> Unit) {
    Box(
        modifier.clip(RoundedCornerShape(14.dp)).clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center
    ) {
        CompositionLocalProvider(LocalContentColor provides (if (enabled) Sk.TealDeep else Sk.Muted)) {
            ProvideTextStyle(SkType.labelLarge) {
                Row(verticalAlignment = Alignment.CenterVertically, content = content)
            }
        }
    }
}

/** حقل إدخال غائر (عكس البروز) تظهر حوافه بالتركيز */
@Composable
fun DepthField(
    value: String, onValueChange: (String) -> Unit, modifier: Modifier = Modifier,
    label: @Composable (() -> Unit)? = null, singleLine: Boolean = false,
    visualTransformation: VisualTransformation = VisualTransformation.None, enabled: Boolean = true
) {
    val src = remember { MutableInteractionSource() }
    val focused by src.collectIsFocusedAsState()
    val shape = RoundedCornerShape(16.dp)
    val edge: Brush = if (focused) SolidColor(Sk.Teal) else Brush.verticalGradient(listOf(Color(0xFFA9BDC3), Color.White))
    TextField(
        value = value, onValueChange = onValueChange,
        modifier = modifier.clip(shape)
            .background(Brush.verticalGradient(listOf(Color(0xFFD7E4E7), Color(0xFFF3F8F9))))
            .border(if (focused) 2.dp else 1.dp, edge, shape),
        enabled = enabled, label = label, singleLine = singleLine, visualTransformation = visualTransformation,
        interactionSource = src, shape = shape,
        colors = TextFieldDefaults.colors(
            focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent,
            disabledContainerColor = Color.Transparent, errorContainerColor = Color.Transparent,
            focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
            disabledIndicatorColor = Color.Transparent, errorIndicatorColor = Color.Transparent,
            cursorColor = Sk.Teal, focusedLabelColor = Sk.TealDeep, unfocusedLabelColor = Sk.Muted,
            focusedTextColor = Sk.Ink, unfocusedTextColor = Sk.Ink
        )
    )
}

/** شريط تنقل عائم داكن مع مفتاح كهرماني للتبويب المحدد */
@Composable
fun DepthDock(content: @Composable RowScope.() -> Unit) {
    val shape = RoundedCornerShape(30.dp)
    Box(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 14.dp, vertical = 10.dp)) {
        Row(
            Modifier.fillMaxWidth()
                .shadow(20.dp, shape, ambientColor = Sk.Ink.copy(alpha = 0.4f), spotColor = Sk.Ink.copy(alpha = 0.55f))
                .clip(shape)
                .background(Brush.verticalGradient(listOf(Sk.Ink2, Sk.Ink)))
                .border(1.dp, Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.28f), Color.White.copy(alpha = 0.04f))), shape)
                .padding(6.dp),
            horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically,
            content = content
        )
    }
}

@Composable
fun RowScope.DockItem(
    selected: Boolean, onClick: () -> Unit,
    icon: @Composable () -> Unit, label: @Composable () -> Unit, badge: Int = 0
) {
    val shape = RoundedCornerShape(22.dp)
    val lift = if (selected) Modifier.shadow(8.dp, shape, ambientColor = Color.Black, spotColor = Color.Black) else Modifier
    val face = if (selected) Modifier
        .background(Brush.verticalGradient(listOf(Sk.AmberLight, Sk.Amber)), shape)
        .border(1.dp, Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.75f), Color.Transparent)), shape)
    else Modifier
    val fg = if (selected) Sk.Ink else Color(0xFFA3BCC3)
    Column(
        Modifier.weight(1f).then(lift).clip(shape).then(face)
            .clickable(role = Role.Tab, onClick = onClick).padding(vertical = 8.dp, horizontal = 2.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        CompositionLocalProvider(LocalContentColor provides fg) {
            Box {
                ProvideTextStyle(TextStyle(fontSize = 20.sp, lineHeight = 26.sp)) { icon() }
                if (badge > 0) {
                    Box(
                        Modifier.align(Alignment.TopEnd).offset(x = 11.dp, y = (-3).dp)
                            .defaultMinSize(minWidth = 17.dp, minHeight = 17.dp)
                            .clip(CircleShape).background(Sk.Coral).padding(horizontal = 4.dp),
                        contentAlignment = Alignment.Center
                    ) { Text("$badge", color = Color.White, fontSize = 10.sp, lineHeight = 13.sp, fontWeight = FontWeight.Bold) }
                }
            }
            ProvideTextStyle(SkType.labelSmall.copy(textAlign = TextAlign.Center)) { label() }
        }
    }
}

@Composable
fun ScreenTitle(title: String, sub: String = "", modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Medallion(46.dp)
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.headlineSmall)
            if (sub.isNotBlank()) Text(sub, style = MaterialTheme.typography.bodySmall, color = Sk.Muted)
        }
    }
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.width(5.dp).height(16.dp).clip(RoundedCornerShape(3.dp)).background(Brush.verticalGradient(listOf(Sk.AmberLight, Sk.Amber))))
        Text(text, style = MaterialTheme.typography.titleSmall)
    }
}

@Composable
fun Pill(text: String, color: Color, onColor: Color = Color.White, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(50)
    Box(
        modifier.shadow(3.dp, shape, ambientColor = color.copy(alpha = 0.5f), spotColor = color.copy(alpha = 0.5f))
            .clip(shape)
            .background(Brush.verticalGradient(listOf(lerp(color, Color.White, 0.28f), color)))
            .border(1.dp, Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.6f), Color.Transparent)), shape)
            .padding(horizontal = 11.dp, vertical = 3.dp)
    ) { Text(text, color = onColor, style = MaterialTheme.typography.labelMedium) }
}

@Composable
fun ChoiceChip(text: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(50)
    val m = if (selected) modifier
        .shadow(6.dp, shape, ambientColor = Sk.TealDeep, spotColor = Sk.TealDeep)
        .clip(shape)
        .background(Brush.verticalGradient(listOf(Sk.TealLight, Sk.TealDeep)))
        .border(1.dp, Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.6f), Color.Transparent)), shape)
    else modifier.plate(shape, 5.dp)
    Box(
        m.clickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            if (selected) "✓ $text" else text,
            color = if (selected) Color.White else Sk.Ink, style = MaterialTheme.typography.labelLarge
        )
    }
}

/** ملاحظة ملوّنة: تنبيه (مرجاني) أو معلومة (تركوازي) مع عنوان اختياري */
@Composable
fun Note(text: String, modifier: Modifier = Modifier, tone: Color = Sk.Coral, title: String = "") {
    val shape = RoundedCornerShape(14.dp)
    Column(
        modifier.fillMaxWidth().clip(shape)
            .background(tone.copy(alpha = 0.10f))
            .border(1.dp, tone.copy(alpha = 0.32f), shape)
            .padding(horizontal = 12.dp, vertical = 9.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp)
    ) {
        if (title.isNotBlank()) Text(title, style = MaterialTheme.typography.labelMedium, color = lerp(tone, Sk.Ink, 0.45f))
        Text(text, style = MaterialTheme.typography.bodySmall, color = Sk.Ink)
    }
}

@Composable
fun Alert(text: String, modifier: Modifier = Modifier) {
    Note(text, modifier, Sk.Coral)
}

@Composable
fun EmptyState(icon: String, title: String, hint: String = "", modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center
    ) {
        Orb(96.dp, Color.White, Color(0xFFC6D8DD)) { Text(icon, fontSize = 40.sp) }
        Spacer(Modifier.height(22.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        if (hint.isNotBlank()) {
            Spacer(Modifier.height(6.dp))
            Text(hint, style = MaterialTheme.typography.bodyMedium, color = Sk.Muted, textAlign = TextAlign.Center)
        }
    }
}

/** مؤشر مراحل: كرات مجسمة على أنبوب؛ المنجزة تركوازية، والحالية كهرمانية، والقادمة رمادية */
@Composable
fun Tracker(steps: List<Pair<String, Boolean>>, modifier: Modifier = Modifier) {
    val cur = steps.indexOfFirst { !it.second }
    Row(modifier.fillMaxWidth()) {
        steps.forEachIndexed { i, s ->
            val done = s.second
            val active = i == cur
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(
                    Modifier.fillMaxWidth().height(30.dp).drawBehind {
                        val h = 6.dp.toPx()
                        val cy = size.height / 2f
                        val cx = size.width / 2f
                        val rtl = layoutDirection == LayoutDirection.Rtl
                        fun tube(x0: Float, x1: Float, on: Boolean) {
                            val br = if (on) Brush.verticalGradient(listOf(Sk.TealLight, Sk.TealDeep), startY = cy - h / 2f, endY = cy + h / 2f)
                            else Brush.verticalGradient(listOf(Color(0xFFB4C6CC), Color(0xFFE6EEF0)), startY = cy - h / 2f, endY = cy + h / 2f)
                            drawRoundRect(
                                br, topLeft = Offset(minOf(x0, x1), cy - h / 2f),
                                size = Size(kotlin.math.abs(x1 - x0), h), cornerRadius = CornerRadius(h / 2f, h / 2f)
                            )
                        }
                        if (i < steps.size - 1) {
                            if (rtl) tube(0f, cx, steps[i + 1].second) else tube(cx, size.width, steps[i + 1].second)
                        }
                        if (i > 0) {
                            if (rtl) tube(cx, size.width, done) else tube(0f, cx, done)
                        }
                    },
                    contentAlignment = Alignment.Center
                ) {
                    when {
                        done -> Orb(26.dp, Sk.TealLight, Sk.TealDeep) { Text("✓", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold) }
                        active -> Orb(26.dp, Sk.AmberLight, Sk.AmberLip) { Text("…", color = Sk.Ink, fontSize = 14.sp, fontWeight = FontWeight.Bold) }
                        else -> Orb(22.dp, Color.White, Color(0xFFB4C6CC))
                    }
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    s.first, textAlign = TextAlign.Center, maxLines = 2,
                    style = MaterialTheme.typography.labelSmall,
                    color = if (done || active) Sk.Ink else Sk.Muted
                )
            }
        }
    }
}
