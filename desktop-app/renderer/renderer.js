const STATUS = { new: 'بانتظار التحليل', routed: 'تم التوجيه', in_progress: 'قيد المعالجة', pending_review: 'بانتظار الاعتماد', resolved: 'تم الحل' };
const PRI = { urgent: 'عاجلة', high: 'عالية', medium: 'متوسطة', low: 'منخفضة' };
let tab = 'new', list = [], settings = {}, staff = [];

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e[k] = v;
  }
  kids.flat().forEach((x) => e.append(x ?? ''));
  return e;
}

/** مشغّل الرسالة الصوتية التي أرسلها المواطن (AAC داخل MP4 مخزّن Base64) */
function voiceBox(c) {
  return h('div', { class: 'voice' },
    h('b', {}, '🎙️ رسالة صوتية من المواطن' + (c.voiceSec ? ' (' + c.voiceSec + ' ث)' : '')),
    h('audio', { controls: true, preload: 'none', src: 'data:audio/mp4;base64,' + c.voiceB64 }),
    c.voiceText ? h('p', { class: 'small' }, '📝 التفريغ: ' + c.voiceText) : '');
}

const fmtT = (ms) => new Date(ms).toLocaleString('ar-IQ', { dateStyle: 'short', timeStyle: 'short' });
function fmtD(ms) {
  if (ms < 0) return '-';
  const m = Math.round(ms / 60000);
  if (m < 60) return m + ' دقيقة';
  const h2 = Math.floor(m / 60);
  if (h2 < 48) return h2 + ' ساعة' + (m % 60 ? ' و' + (m % 60) + ' دقيقة' : '');
  return Math.floor(h2 / 24) + ' يوم' + (h2 % 24 ? ' و' + (h2 % 24) + ' ساعة' : '');
}
// بداية العمل الفعلي: استلام الكادر، وإلا بدء المعالجة، وإلا التوجيه
const workStart = (c) => c.crewMs || c.startedMs || c.routedMs || c.createdMs;

// ---------------- تقرير مسار الشكوى: لون مميّز لكل جهة ----------------
const ACTORS = {
  citizen: { name: 'المواطن', ico: '👤' },
  manager: { name: 'المدير', ico: '🧑‍💼' },
  system: { name: 'النظام', ico: '🤖' },
  dept: { name: 'موظف القسم', ico: '🗂️' },
  crew: { name: 'الكادر', ico: '🚧' },
};
// تحديد الجهة من اسم كاتب السجل (حسابات الموظفين: كادر أو موظف قسم)
function actorOf(by) {
  const b = String(by || '').trim();
  if (b === 'المواطن') return 'citizen';
  if (b === 'المدير') return 'manager';
  if (b === 'النظام') return 'system';
  const s = staff.find((x) => (x.name && x.name === b) || (x.email && x.email === b));
  return s && s.role === 'crew' ? 'crew' : 'dept';
}
const actorChip = (k, label) => h('span', { class: 'actor-chip act-' + k }, ACTORS[k].ico + ' ' + (label || ACTORS[k].name));

function timeline(c) {
  const crewN = c.crew ? crewLabel(c) : '';
  const ev = [
    ['📥', 'وصول الشكوى', 'citizen', c.createdMs, c.name ? 'أرسلها: ' + c.name : ''],
    ['➡️', 'التوجيه إلى القسم', 'system', c.routedMs, c.department || ''],
    ['🚧', 'إسناد الشكوى للكادر', 'dept', c.crewMs, crewN ? 'استلمها: ' + crewN : ''],
    ['📍', 'وصول الكادر إلى الموقع', 'crew', c.arrivedMs, ''],
    ['📋', 'تقرير الكشف', 'crew', c.assessedMs, c.repairable === true ? '✅ ممكن صيانتها' + (c.materials ? ' — المواد: ' + c.materials : '') : c.repairable === false ? '❌ غير ممكن صيانتها' : ''],
    ['📦', 'تجهيز المواد', 'manager', c.materialsReadyMs, ''],
    ['🔧', 'بدء المعالجة', 'crew', c.startedMs, ''],
    ['🔁', 'إعادة فتح الشكوى', 'citizen', c.reopenedMs, c.reopenReason || ''],
    ['📨', 'إرسال الكادر للإنجاز', 'crew', c.submittedMs, c.reply || ''],
    ['✔️', 'اعتماد القسم للإنجاز', 'manager', c.approvedMs, ''],
    ['✅', 'إنجاز الشكوى', 'system', c.resolvedMs, c.confirmed ? 'أكّد المواطن أن المشكلة حُلّت' : ''],
  ].filter((r) => r[3]).sort((a, b) => a[3] - b[3]);
  if (!ev.length) return '';

  const tiles = [];
  const tile = (v, l, cls) => tiles.push(h('div', { class: 'tile' + (cls ? ' ' + cls : '') }, h('b', {}, v), h('small', {}, l)));
  if (c.resolvedMs) {
    tile(fmtD(c.resolvedMs - workStart(c)), '⏱ مدة الإنجاز من الاستلام', 'ok');
    tile(fmtD(c.resolvedMs - c.createdMs), '⏱ المدة الكلية');
    if (c.approvedMs && c.submittedMs) tile(fmtD(c.approvedMs - c.submittedMs), '🕵️ زمن مراجعة القسم');
  } else if (c.status !== 'new' && c.createdMs) {
    tile(fmtD(Date.now() - c.createdMs), '⏳ مضى ولم تُنجز', 'warn');
    if (c.status === 'pending_review' && c.submittedMs) tile(fmtD(Date.now() - c.submittedMs), '🔎 بانتظار الاعتماد', 'warn');
  }
  const present = [...new Set(ev.map((e) => e[2]))];
  return h('div', { class: 'rpt-wrap' },
    h('div', { class: 'rpt-head' }, h('h4', {}, '📑 تقرير مسار الشكوى'), ...present.map((k) => actorChip(k))),
    tiles.length ? h('div', { class: 'tiles rpt-tiles' }, ...tiles) : '',
    h('div', { class: 'rpt-line' }, ...ev.map(([ico, label, k, ms, detail], i) => h('div', { class: 'rpt-ev act-' + k },
      h('div', { class: 'rpt-dot' }, ico),
      h('div', { class: 'rpt-card' },
        h('div', { class: 'rpt-top' }, h('b', {}, label), actorChip(k), h('span', { class: 'small' }, fmtT(ms)),
          i > 0 && ms - ev[i - 1][3] > 0 ? h('span', { class: 'rpt-gap' }, '+' + fmtD(ms - ev[i - 1][3])) : ''),
        detail ? h('div', { class: 'small rpt-detail' }, detail) : '')))));
}

// شريط مراحل الشكوى: استُلمت ← وُجِّهت ← أُسندت ← الكشف ← المواد ← الإنجاز
function stageSteps(c) {
  const s = [
    ['📥 استُلمت', true],
    ['➡️ وُجِّهت', c.status !== 'new'],
    ['🚧 أُسندت' + (c.crew ? ' (' + c.crew + ')' : ''), !!c.crew],
    ['🔍 الكشف', !!(c.arrivedMs || c.assessedMs) || c.status === 'resolved' || c.status === 'pending_review'],
  ];
  if (c.repairable === false) s.push(['🚫 غير ممكن الصيانة — بانتظار قرار الإدارة', false]);
  else if (c.repairable === true && c.materials) s.push(['📦 المواد', ['ready', 'received'].includes(c.materialsStatus) || !!c.materialsReady || c.status === 'resolved' || c.status === 'pending_review']);
  s.push(['✅ الإنجاز', c.status === 'resolved' || c.status === 'pending_review']);
  if (c.crew) s.push(['🕵️ اعتماد القسم', c.status === 'resolved']);
  const cur = s.findIndex((x) => !x[1]);
  return h('div', { class: 'sum' }, ...s.map((x, i) => h('span', { class: x[1] ? 'chip ok' : i === cur ? 'chip warn' : 'chip' }, (x[1] ? '✔ ' : i === cur ? '⏳ ' : '○ ') + x[0])));
}

const MAT_AR = { requested: '📦 مطلوبة بانتظار التجهيز', preparing: '⏳ قيد التجهيز', partial: '⚠️ نقص جزئي', ready: '✅ جاهزة بانتظار استلام الكادر', received: '✅ استلمها الكادر' };
const matStatusOf = (c) => c.materialsStatus || (c.materialsReady ? 'ready' : 'requested');

// (2) دورة المواد: مطلوبة › قيد التجهيز › نقص جزئي › جاهزة › استلمها الكادر
function materialsBox(c) {
  const ms = matStatusOf(c);
  const kids = [h('p', { class: ms === 'partial' ? 'rep no' : 'rep yes' },
    'حالة المواد: ' + MAT_AR[ms] + (ms === 'partial' && c.materialsNote ? ' — الناقص: ' + c.materialsNote : ''))];
  if (ms !== 'ready' && ms !== 'received') {
    const note = h('input', { type: 'text', placeholder: 'الناقص من المواد (للنقص الجزئي)' });
    kids.push(h('div', { class: 'bar' },
      ms === 'requested' ? h('button', { class: 'act', onclick: () => window.api.materialsStatus(c.id, 'preparing', '') }, '⏳ قيد التجهيز') : '',
      note,
      h('button', { class: 'act', onclick: () => { if (!note.value.trim()) { note.focus(); return; } window.api.materialsStatus(c.id, 'partial', note.value.trim()); } }, '⚠️ نقص جزئي'),
      h('button', { class: 'act', onclick: () => window.api.materialsReady(c.id) }, '📦 تم تجهيز المواد (إشعار الكادر)')));
  }
  return h('div', {}, ...kids);
}

// (1) اعتماد إنجاز الكادر قبل وصوله للمواطن
function reviewBox(c) {
  if (c.status !== 'pending_review') return '';
  const note = h('input', { type: 'text', placeholder: 'سبب الإرجاع للكادر' });
  return h('div', { class: 'rep no' },
    h('b', {}, '🔎 الكادر أرسل الإنجاز وبانتظار اعتماد القسم'),
    c.reply ? h('div', {}, 'ملخص العمل: ' + c.reply) : '',
    h('div', { class: 'bar' },
      h('button', { class: 'act', onclick: () => window.api.reviewApprove(c.id) }, '✅ اعتماد وإرسال للمواطن'),
      note,
      h('button', { class: 'act', onclick: () => { if (!note.value.trim()) { note.focus(); return; } window.api.reviewReturn(c.id, note.value.trim()); } }, '↩️ إرجاع للكادر')));
}

// سجل الشكوى كتقرير ملوّن حسب الجهة مع أزرار تصفية
function logButton(id) {
  const box = h('div', { class: 'rpt-wrap hide' });
  let items = [], only = 'all', loaded = false;
  const draw = () => {
    const present = [...new Set(items.map((i) => actorOf(i.by)))];
    const shown = items.filter((i) => only === 'all' || actorOf(i.by) === only);
    box.replaceChildren(
      h('div', { class: 'rpt-head' }, h('h4', {}, '🕘 سجل الشكوى (' + items.length + ')'),
        h('button', { class: 'pill' + (only === 'all' ? ' on' : ''), onclick: () => { only = 'all'; draw(); } }, 'الكل'),
        ...present.map((k) => h('button', { class: 'pill act-' + k + (only === k ? ' on' : ''), onclick: () => { only = k; draw(); } }, ACTORS[k].ico + ' ' + ACTORS[k].name))),
      h('div', { class: 'rpt-line' }, ...shown.map((i) => {
        const k = actorOf(i.by);
        return h('div', { class: 'rpt-ev act-' + k },
          h('div', { class: 'rpt-dot' }, ACTORS[k].ico),
          h('div', { class: 'rpt-card' },
            h('div', { class: 'rpt-top' }, actorChip(k, ACTORS[k].name + (i.by && i.by !== ACTORS[k].name ? ' — ' + i.by : '')), h('span', { class: 'small' }, new Date(i.ms).toLocaleString('ar-IQ'))),
            h('div', { class: 'rpt-detail' }, i.action)));
      })));
  };
  const btn = h('button', { class: 'act', onclick: async () => {
    if (!box.classList.contains('hide')) { box.classList.add('hide'); return; }
    box.classList.remove('hide');
    if (!loaded) {
      box.replaceChildren(h('p', { class: 'small' }, 'جارٍ التحميل…'));
      items = await window.api.getLog(id); loaded = true;
    }
    if (!items.length) { box.replaceChildren(h('p', { class: 'small' }, 'لا يوجد سجل بعد')); loaded = false; return; }
    draw();
  } }, '🕘 سجل الشكوى');
  return h('div', {}, btn, box);
}

const PRI_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };

function priorityPicker(c) {
  if (c.status === 'new' || c.status === 'resolved') return '';
  const sel = h('select', { onchange: (e) => window.api.setPriority(c.id, e.target.value) },
    ...Object.entries(PRI).map(([k, v]) => h('option', { value: k }, v)));
  sel.value = c.priority || 'medium';
  return h('div', { class: 'small' }, 'تغيير الأولوية: ', sel);
}

function cardBody(c) {
  return [
    c.imageB64 ? h('img', { src: 'data:image/jpeg;base64,' + c.imageB64 }) : '',
    c.voiceB64 ? voiceBox(c) : '',
    h('p', {}, c.text),
    (c.name || c.phone) ? h('p', { class: 'actor-line act-citizen' }, actorChip('citizen'), ' ' + [c.name, c.phone].filter(Boolean).join(' • ')) : '',
    c.status !== 'new' ? stageSteps(c) : '',
    reviewBox(c),
    (c.blockedReason && !c.crew && c.status !== 'resolved') ? h('p', { class: 'rep no' }, '🚫 تعذّر على الكادر ' + (c.blockedBy || '') + ': ' + c.blockedReason + ' — بانتظار إعادة الإسناد') : '',
    (c.returnNote && c.status === 'in_progress') ? h('p', { class: 'rep no' }, '↩️ أُرجعت للكادر: ' + c.returnNote) : '',
    (c.repairable === true && c.materials && c.status !== 'resolved' && c.status !== 'pending_review') ? materialsBox(c) : '',
    c.reopenCount ? h('p', { class: 'rep no' }, '🔁 أعاد المواطن فتحها ' + c.reopenCount + ' مرة' + (c.reopenReason ? ' — السبب: ' + c.reopenReason : '')) : '',
    c.confirmed ? h('p', { class: 'rep yes' }, '✔ أكّد المواطن أن المشكلة حُلّت') : '',
    c.category ? h('p', { class: 'small' }, '🗂 النوع الذي اختاره المواطن: ' + c.category + (c.aiDepartment ? ' (اقترح التحليل: ' + c.aiDepartment + ')' : '')) : '',
    c.area ? h('p', { class: 'small' }, '📍 الحي الذي اختاره المواطن: ' + c.area + (c.sector ? ' (' + c.sector + ')' : '')) : '',
    c.dupTitle ? h('p', { class: 'rep no' }, '🔁 مكررة: تشبه شكوى سابقة («' + c.dupTitle + '»)') : '',
    c.dupCount ? h('p', { class: 'small' }, '🔁 تكررت هذه الشكوى ' + c.dupCount + ' مرة') : '',
    c.lat !== null ? h('button', { class: 'act', onclick: () => window.api.openMap(c.lat, c.lng) }, '📍 فتح الموقع على الخريطة') : '',
    c.crew ? h('p', { class: 'actor-line act-crew' }, actorChip('crew', 'الكادر المسؤول'), ' ' + crewLabel(c)) : '',
    c.afterImageB64 ? h('div', {}, h('b', {}, 'صورة بعد الصيانة:'), h('img', { src: 'data:image/jpeg;base64,' + c.afterImageB64 })) : '',
    c.rating ? h('p', {}, 'تقييم المواطن: ' + '⭐'.repeat(c.rating)) : '',
    timeline(c),
    priorityPicker(c),
    c.aiSummary ? h('p', { class: 'ai' }, '🤖 ' + c.aiSummary) : '',
    (c.repairable === true || c.repairable === false) ? h('div', { class: c.repairable ? 'rep yes' : 'rep no' },
      h('b', {}, c.repairable ? '✅ تقرير الموظف: ممكن صيانتها' : '❌ تقرير الموظف: غير ممكن صيانتها'),
      c.branch ? h('div', {}, 'الفرع: ' + c.branch) : '',
      (c.repairable && c.materials) ? h('div', {}, 'المواد المطلوبة: ' + c.materials) : '') : '',
    c.reply ? h('p', { class: 'actor-line act-dept' }, actorChip('dept', 'رد الموظف'), ' ' + c.reply) : '',
    c.status === 'new' ? h('button', { class: 'act', onclick: () => window.api.analyze(c.id) }, 'تحليل وتوجيه الآن') : '',
    logButton(c.id)
  ];
}

// ---------------- بطاقة الشكوى المختصرة: تُفتح التفاصيل بالضغط ----------------
const openCards = new Set();
function card(c) {
  const now = Date.now();
  const urgent = c.priority === 'urgent' && c.status !== 'resolved';
  const info = c.status !== 'new' ? jobInfo(c, now) : null;
  const wrap = h('div', { class: 'card cpl st-' + c.status + (urgent ? ' urgent' : '') });
  const body = h('div', { class: 'cpl-body' });
  let open = openCards.has(c.id);
  const chev = h('span', { class: 'cpl-chev' }, open ? '▾' : '◂');
  const set = (v) => {
    open = v; if (v) openCards.add(c.id); else openCards.delete(c.id);
    chev.textContent = v ? '▾' : '◂';
    wrap.classList.toggle('open', v);
    if (v) body.replaceChildren(...cardBody(c)); else body.replaceChildren();
  };
  const thumb = h('div', { class: 'cpl-thumb' + (c.imageB64 ? '' : ' none') }, c.imageB64 ? '' : '📣');
  if (c.imageB64) thumb.style.backgroundImage = 'url(data:image/jpeg;base64,' + c.imageB64 + ')';
  const pc = c.priority === 'urgent' ? 'chip bad' : c.priority === 'high' ? 'chip warn' : 'chip';
  const stc = c.status === 'resolved' ? 'chip ok' : (c.status === 'new' || c.status === 'pending_review') ? 'chip warn' : 'chip';
  const flow = c.resolvedMs && c.createdMs ? '⏱ أُنجزت خلال ' + fmtD(c.resolvedMs - c.createdMs)
    : (c.status !== 'new' && c.createdMs ? '⏳ مضى ' + fmtD(now - c.createdMs) : '');
  const snippet = (c.text || c.aiSummary || '').replace(/\s+/g, ' ').slice(0, 120);
  const sum = h('div', { class: 'cpl-sum', onclick: () => set(!open) },
    thumb,
    h('div', { class: 'cpl-main' },
      h('b', { class: 'cpl-title' }, (urgent ? '🚨 ' : '') + c.title),
      h('div', { class: 'cpl-chips' },
        actorChip('citizen', (c.name || 'مواطن') + (c.phone ? ' • ' + c.phone : '')),
        h('span', { class: stc }, STATUS[c.status] || c.status),
        c.priority ? h('span', { class: pc }, 'أولوية ' + PRI[c.priority]) : '',
        c.department ? h('span', { class: 'chip' }, '🏢 ' + c.department) : '',
        c.crew ? actorChip('crew', crewLabel(c)) : '',
        info && info.late ? h('span', { class: 'chip bad' }, '🔴 متأخر ' + fmtD(info.over)) : '',
        c.repairable === false ? h('span', { class: 'chip bad' }, '❌ غير ممكن صيانتها') : '',
        (c.reopenCount || c.dupTitle) ? h('span', { class: 'chip warn' }, c.reopenCount ? '🔁 أُعيد فتحها ' + c.reopenCount : '🔁 مكررة') : '',
        c.voiceB64 ? h('span', { class: 'chip' }, '🎙️ صوت') : '',
        c.rating ? h('span', { class: 'chip stars' }, stars(c.rating)) : ''),
      snippet ? h('div', { class: 'small cpl-snip' }, snippet) : '',
      h('div', { class: 'small' }, [c.createdMs ? '🕘 ' + fmtT(c.createdMs) : '', flow].filter(Boolean).join(' • '))),
    c.status === 'new' ? h('button', { class: 'act org-btn', onclick: (e) => { e.stopPropagation(); window.api.analyze(c.id); } }, 'تحليل وتوجيه') : '',
    chev);
  wrap.append(sum, body);
  if (open) { wrap.classList.add('open'); body.replaceChildren(...cardBody(c)); }
  return wrap;
}

function renderSettings() {
  const provider = h('select', {},
    h('option', { value: 'claude' }, 'سحابي (يحتاج مفتاحاً ورصيداً)'),
    h('option', { value: 'local' }, 'محلي (مجاني، بدون إنترنت)'),
    h('option', { value: 'hybrid' }, 'هجين: المحلي أولاً ثم السحابي عند الشك أو الفشل'));
  provider.value = settings.provider || 'claude';
  const ollamaUrl = h('input', { type: 'text', class: 'mask', value: settings.ollamaUrl || 'http://localhost:11434' });
  const ollamaModel = h('input', { type: 'text', class: 'mask', value: settings.ollamaModel || '' });
  const localImages = h('input', { type: 'checkbox', checked: !!settings.localImages });
  const sttUrl = h('input', { type: 'text', class: 'mask', value: settings.sttUrl || 'https://api.openai.com/v1/audio/transcriptions' });
  const sttKey = h('input', { type: 'password', class: 'sec', value: settings.sttKey || '' });
  const sttModel = h('input', { type: 'text', class: 'mask', value: settings.sttModel || 'whisper-1' });
  const rules = h('textarea', { class: 'mask', value: settings.rules || '', rows: 8 });
  const key = h('input', { type: 'password', class: 'sec', value: settings.apiKey || '' });
  const model = h('input', { type: 'text', class: 'mask', value: settings.model || '' });
  const depts = h('textarea', { value: (settings.departments || []).join('\n') });
  const auto = h('input', { type: 'checkbox', checked: !!settings.auto });
  const autoCrew = h('input', { type: 'checkbox', checked: settings.autoCrew !== false });
  const usePriority = h('input', { type: 'checkbox', checked: settings.usePriority !== false });
  const path = h('span', {}, settings.serviceAccountPath || 'لم يُحدد بعد');
  return [
    h('div', { class: 'card' },
      h('label', {}, 'طريقة التحليل'), provider,
      h('label', {}, 'مفتاح التحليل السحابي (للوضعين السحابي والهجين)'), key,
      h('label', {}, 'اسم النموذج'), model,
      h('label', {}, 'عنوان المحرك المحلي'), ollamaUrl,
      h('label', {}, 'اسم النموذج المحلي'), ollamaModel,
      h('label', {}, localImages, ' النموذج المحلي يدعم الصور (فعّلها فقط لنموذج يفهم الصور)'),
      h('button', { class: 'act', onclick: () => window.api.testOllama() }, 'فحص اتصال المحرك المحلي'),
      h('label', {}, '🎙️ تفريغ الرسائل الصوتية إلى نص ليحللها الذكاء الاصطناعي: عنوان الخدمة'), sttUrl,
      h('label', {}, 'مفتاح خدمة التفريغ'), sttKey,
      h('label', {}, 'نموذج التفريغ'), sttModel,
      h('label', {}, 'تعليمات التوجيه (اشرح للنموذج أي شكوى تذهب لأي قسم)'), rules,
      h('label', {}, 'الأقسام (قسم في كل سطر — يجب أن تطابق أقسام الموظفين تماماً)'), depts,
      h('label', {}, auto, ' التحليل والتوجيه التلقائي للشكاوى الجديدة'),
      h('label', {}, usePriority, ' تحديد أولوية الشكوى تلقائياً (إن ألغيته تُوجَّه الشكاوى بلا أولوية ويبقى للمدير تحديدها يدوياً)'),
      h('label', {}, autoCrew, ' إسناد الشكوى تلقائياً إلى كادر متاح في نفس القسم (الأعجل أولاً) دون انتظار إدارة القسم'),
      h('label', {}, '🗄️ نسخة محلية ثانوية (SQLite) للشكاوى على هذا الحاسوب: نسخ احتياطي وتقارير، تبقى حتى لو حُذفت البيانات من الخادم'),
      h('button', { class: 'act', onclick: () => window.api.openArchive() }, 'فتح مجلد النسخة المحلية'),
      h('label', {}, 'ملف ربط قاعدة البيانات (JSON)'),
      h('button', { class: 'act', onclick: async () => { const p = await window.api.pickKey(); settings.serviceAccountPath = p; path.textContent = p || 'لم يُحدد بعد'; } }, 'اختيار الملف'), ' ', path,
      h('p', {}),
      h('button', {
        class: 'act',
        onclick: async () => {
          settings = {
            ...settings, provider: provider.value, rules: rules.value.trim(), ollamaUrl: ollamaUrl.value.trim(), ollamaModel: ollamaModel.value.trim(), localImages: localImages.checked,
            sttUrl: sttUrl.value.trim(), sttKey: sttKey.value.trim(), sttModel: sttModel.value.trim(),
            apiKey: key.value.trim(), model: model.value.trim(), auto: auto.checked, autoCrew: autoCrew.checked, usePriority: usePriority.checked,
            departments: depts.value.split('\n').map((s) => s.trim()).filter(Boolean),
          };
          await window.api.setSettings(settings);
          await window.api.connect();
        },
      }, 'حفظ وإعادة الاتصال')),
    resetCard(),
  ];
}

// تصفير البيانات: يحذف الشكاوى (وسجلاتها) فقط، والإعدادات تبقى كما هي
// بطاقة التصفير (محمية بكلمة سر المبرمج، وهي غير مكتوبة في الكود بل بصمتها SHA-256 فقط):
//  - الضغط على زر «تصفير البيانات» 5 مرات (بلا كلمة سر، مع نافذة تأكيد) ← تصفير البيانات
//  - الضغط على عنوان البطاقة 10 مرات ثم كلمة السر ← إظهار معلومات إعدادات الذكاء المخفية (حتى مغادرة الصفحة)
// يتصفّر العدّاد إن توقف الضغط 4 ثوانٍ.
const RESET_HASH = 'b1818102ceded0ff9e22511d1e452c1b56e413ff7693927b5b05806674f8c826';
async function sha256Hex(t) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function resetCard() {
  const st = h('span', { class: 'small' });
  let mode = '', rClicks = 0, tClicks = 0, rTimer = null, tTimer = null;
  const pw = h('input', { type: 'password', style: 'display:none;max-width:220px', placeholder: 'كلمة السر' });
  const ask = (m) => { mode = m; st.textContent = 'اكتب كلمة السر ثم اضغط Enter'; pw.style.display = ''; pw.focus(); };
  pw.addEventListener('keydown', async (ev) => {
    if (ev.key !== 'Enter') return;
    const ok = (await sha256Hex(pw.value)) === RESET_HASH;
    pw.value = '';
    if (!ok) { st.textContent = '❌ كلمة السر غير صحيحة'; return; }
    pw.style.display = 'none';
    const m = mode; mode = '';
    if (m === 'show') {
      document.querySelectorAll('.mask').forEach((e) => e.classList.remove('mask'));
      document.querySelectorAll('.sec').forEach((e) => { e.type = 'text'; });
      st.textContent = '';
      return;
    }
  });
  const doReset = async () => {
    if (!(await askConfirm('حذف كل البيانات نهائياً؟\n(الشكاوى + حسابات الموظفين والكوادر)\nلا يمكن التراجع، والإعدادات لا تتأثر.'))) { st.textContent = ''; return; }
    st.textContent = '...';
    const r = await window.api.resetData();
    st.textContent = r.ok ? '✅ ' + r.message : '❌ ' + r.error;
  };
  const title = h('h3', { style: 'user-select:none', onclick: () => {
    clearTimeout(tTimer);
    if (++tClicks >= 10) { tClicks = 0; ask('show'); return; }
    tTimer = setTimeout(() => { tClicks = 0; }, 4000);
  } }, '🧹 تصفير البيانات');
  return h('div', { class: 'card' },
    title,
    h('p', { class: 'small' }, 'يحذف كل شيء نهائياً: الشكاوى وسجلاتها وحسابات الموظفين والكوادر وقوائم الكوادر. الإعدادات فقط (المفاتيح، الأقسام، القواطع، تعليمات التوجيه) تبقى كما هي.'),
    h('button', {
      class: 'act',
      onclick: () => {
        clearTimeout(rTimer);
        if (++rClicks >= 5) { rClicks = 0; doReset(); return; }
        rTimer = setTimeout(() => { rClicks = 0; }, 4000);
      },
    }, '🗑 تصفير البيانات'), ' ', pw, ' ', st);
}

function branchStats() {
  const depts = (settings.departments && settings.departments.length)
    ? settings.departments
    : [...new Set(list.map((c) => c.department).filter(Boolean))];
  return depts.map((dept) => {
    const names = new Set();
    staff.filter((s) => s.departments.includes(dept)).forEach((s) => s.branches.forEach((b) => names.add(b)));
    const inDept = list.filter((c) => c.department === dept && c.status !== 'new');
    inDept.forEach((c) => { if (c.branch) names.add(c.branch); });
    const rows = [...names].map((b) => {
      const cs = inDept.filter((c) => c.branch === b);
      const open = cs.filter((c) => c.status !== 'resolved').length;
      return {
        branch: b, total: cs.length, open, done: cs.length - open,
        can: cs.filter((c) => c.repairable === true).length,
        cant: cs.filter((c) => c.repairable === false).length,
      };
    });
    const nb = inDept.filter((c) => !c.branch);
    return { dept, rows, noBranchTotal: nb.length, noBranchOpen: nb.filter((c) => c.status !== 'resolved').length };
  }).filter((d) => d.rows.length || d.noBranchTotal);
}

function crewStats() {
  const depts = (settings.departments && settings.departments.length)
    ? settings.departments
    : [...new Set(list.map((c) => c.department).filter(Boolean))];
  return depts.map((dept) => {
    const names = new Set();
    staff.filter((s) => s.departments.includes(dept)).forEach((s) => (s.crews || []).forEach((k) => names.add(k)));
    const inDept = list.filter((c) => c.department === dept && c.status !== 'new');
    inDept.forEach((c) => { if (c.crew) names.add(c.crew); });
    const rows = [...names].map((k) => {
      const cs = inDept.filter((c) => c.crew === k);
      const open = cs.filter((c) => c.status !== 'resolved').length;
      const rs = cs.filter((c) => c.rating > 0);
      const dn = cs.filter((c) => c.resolvedMs);
      const avgT = dn.length ? fmtD(dn.reduce((a, c) => a + (c.resolvedMs - workStart(c)), 0) / dn.length) : '-';
      return { crew: k, total: cs.length, open, done: cs.length - open, avgT, avg: rs.length ? (rs.reduce((a, c) => a + c.rating, 0) / rs.length).toFixed(1) + ' (' + rs.length + ')' : '-' };
    });
    const un = inDept.filter((c) => !c.crew && c.status !== 'resolved').length;
    const allR = inDept.filter((c) => c.rating > 0);
    const deptAvg = allR.length ? (allR.reduce((a, c) => a + c.rating, 0) / allR.length).toFixed(1) + ' من 5 (' + allR.length + ' تقييم)' : 'لا تقييمات بعد';
    return { dept, rows, unassigned: un, deptAvg };
  }).filter((d) => d.rows.length);
}

function renderCrews() {
  return crewStats().map((d) => {
    const busy = d.rows.filter((r) => r.open > 0).length;
    return h('div', { class: 'card' },
      h('h3', {}, 'كوادر الصيانة — ' + d.dept),
      h('div', { class: 'sum' },
        h('span', { class: 'chip' }, 'عدد الكوادر: ' + d.rows.length),
        h('span', { class: 'chip warn' }, 'كوادر مشغولة: ' + busy),
        h('span', { class: 'chip ok' }, 'كوادر متاحة: ' + (d.rows.length - busy)),
        h('span', { class: 'chip' }, 'شكاوى غير مُسندة: ' + d.unassigned),
        h('span', { class: 'chip' }, '⭐ تقييم القسم: ' + d.deptAvg)),
      h('table', {},
        h('tr', {}, ...['الكادر', 'المُسند إليه', 'المتبقي', 'المنجز', 'متوسط زمن الإنجاز', 'التقييم'].map((x) => h('th', {}, x))),
        ...d.rows.map((r) => h('tr', {},
          h('td', {}, r.crew), h('td', {}, String(r.total)),
          h('td', { class: r.open ? 'warn' : '' }, String(r.open)), h('td', {}, String(r.done)), h('td', {}, r.avgT), h('td', {}, r.avg)))));
  });
}

// ---------------- الفرز والتقسيم إلى صفحات ----------------
const pager = { size: 20, page: {}, sig: {} };
const PAGE_SIZES = [10, 20, 50, 100];
function pagerBar(key, total, pages, p, start, shown) {
  const go = (n) => { pager.page[key] = n; render(); document.getElementById('view').scrollTop = 0; window.scrollTo(0, 0); };
  const nums = [];
  for (let i = Math.max(1, p - 3); i <= Math.min(pages, p + 3); i++) nums.push(i);
  return h('div', { class: 'card bar pager' },
    h('span', { class: 'small' }, total ? 'عرض ' + (start + 1) + ' – ' + (start + shown) + ' من ' + total : 'لا توجد نتائج'),
    pages > 1 ? h('button', { class: 'act', disabled: p <= 1, onclick: () => go(1) }, '«') : '',
    pages > 1 ? h('button', { class: 'act', disabled: p <= 1, onclick: () => go(p - 1) }, 'السابق') : '',
    ...(pages > 1 ? nums.map((n) => h('button', { class: n === p ? 'act cur' : 'act', onclick: () => go(n) }, String(n))) : []),
    pages > 1 ? h('button', { class: 'act', disabled: p >= pages, onclick: () => go(p + 1) }, 'التالي') : '',
    pages > 1 ? h('button', { class: 'act', disabled: p >= pages, onclick: () => go(pages) }, '»') : '',
    h('span', { class: 'small' }, 'الصفحة ' + p + ' من ' + pages),
    h('label', {}, 'في الصفحة: ', sel(PAGE_SIZES.map((n) => [String(n), String(n)]), String(pager.size), (v) => { pager.size = parseInt(v, 10); pager.page = {}; render(); })));
}
// sig: توقيع الفلاتر والفرز؛ إذا تغيّر نعود للصفحة الأولى
function paginate(key, items, sig) {
  if (pager.sig[key] !== sig) { pager.sig[key] = sig; pager.page[key] = 1; }
  const total = items.length, pages = Math.max(1, Math.ceil(total / pager.size));
  const p = Math.min(Math.max(1, pager.page[key] || 1), pages);
  pager.page[key] = p;
  const start = (p - 1) * pager.size;
  const slice = items.slice(start, start + pager.size);
  return { slice, bar: () => pagerBar(key, total, pages, p, start, slice.length) };
}
const MAIN_SORTS = {
  smart: ['الأهم أولاً (الأولوية ثم الأحدث)', (a, b) => rankOf(a) - rankOf(b) || b.createdMs - a.createdMs],
  newest: ['الأحدث أولاً', (a, b) => b.createdMs - a.createdMs],
  oldest: ['الأقدم أولاً', (a, b) => a.createdMs - b.createdMs],
  priority: ['حسب الأولوية', (a, b) => (PRI_RANK[a.priority] ?? 4) - (PRI_RANK[b.priority] ?? 4) || b.createdMs - a.createdMs],
  dept: ['حسب القسم', (a, b) => String(a.department).localeCompare(String(b.department), 'ar') || b.createdMs - a.createdMs],
  status: ['حسب الحالة', (a, b) => ORD(['routed', 'in_progress', 'pending_review', 'resolved'], a.status) - ORD(['routed', 'in_progress', 'pending_review', 'resolved'], b.status) || b.createdMs - a.createdMs],
  crew: ['حسب الكادر', (a, b) => String(a.crew || '~').localeCompare(String(b.crew || '~'), 'ar') || b.createdMs - a.createdMs],
  oldopen: ['الأقدم غير المنجزة أولاً', (a, b) => (a.status === 'resolved') - (b.status === 'resolved') || a.createdMs - b.createdMs],
};
function rankOf(c) { return c.status === 'resolved' ? 9 : (PRI_RANK[c.priority] ?? 4); }
let mainSort = 'smart';
const DONE_SORTS = {
  newest: ['الأحدث إنجازاً', (a, b) => (b.resolvedMs || 0) - (a.resolvedMs || 0)],
  oldest: ['الأقدم إنجازاً', (a, b) => (a.resolvedMs || 0) - (b.resolvedMs || 0)],
  fastest: ['الأسرع إنجازاً', (a, b) => ((a.resolvedMs || 0) - workStart(a)) - ((b.resolvedMs || 0) - workStart(b))],
  slowest: ['الأبطأ إنجازاً', (a, b) => ((b.resolvedMs || 0) - workStart(b)) - ((a.resolvedMs || 0) - workStart(a))],
  rating_hi: ['الأعلى تقييماً', (a, b) => b.rating - a.rating || (b.resolvedMs || 0) - (a.resolvedMs || 0)],
  rating_lo: ['الأقل تقييماً', (a, b) => (a.rating || 9) - (b.rating || 9) || (b.resolvedMs || 0) - (a.resolvedMs || 0)],
};
let doneSort = 'newest';

// ---------------- تكبير الصور عند الضغط ----------------
function zoom(src) {
  const o = h('div', { class: 'lb', onclick: () => o.remove() }, h('img', { src }));
  document.body.append(o);
}

// ---------------- تصنيف الشكاوى ----------------
const DAY = 86400000;
const DAYS_AR = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
const dayIdx = (d) => (d.getDay() + 1) % 7; // السبت = 0
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const dayLabel = (d) => {
  const t = new Date(), k = ymd(d);
  if (k === ymd(t)) return 'اليوم — ' + d.toLocaleDateString('ar-IQ', { dateStyle: 'full' });
  if (k === ymd(new Date(t.getTime() - DAY))) return 'أمس — ' + d.toLocaleDateString('ar-IQ', { dateStyle: 'full' });
  return d.toLocaleDateString('ar-IQ', { dateStyle: 'full' });
};
const ORD = (arr, v) => { const i = arr.indexOf(v); return i < 0 ? 99 : i; };
const speedOf = (c) => {
  if (!c.resolvedMs) return { k: 9, l: 'غير منجزة بعد' };
  const hrs = (c.resolvedMs - workStart(c)) / 3600000;
  if (hrs < 1) return { k: 0, l: 'أقل من ساعة' };
  if (hrs < 24) return { k: 1, l: 'أقل من يوم' };
  if (hrs < 72) return { k: 2, l: 'من 1 إلى 3 أيام' };
  return { k: 3, l: 'أكثر من 3 أيام' };
};
// طرق التصنيف: كل واحدة تعيد مفتاح الترتيب والعنوان؛ desc = الأحدث أولاً
const CLS = {
  day: { name: 'اليوم (التاريخ)', desc: true, f: (c) => { const d = new Date(c.createdMs); return { k: ymd(d), l: dayLabel(d) }; } },
  week: { name: 'الأسبوع', desc: true, f: (c) => {
    const d = new Date(c.createdMs); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - dayIdx(d));
    return { k: ymd(d), l: 'أسبوع يبدأ السبت ' + d.toLocaleDateString('ar-IQ', { dateStyle: 'long' }) };
  } },
  month: { name: 'الشهر', desc: true, f: (c) => { const d = new Date(c.createdMs); return { k: ymd(d).slice(0, 7), l: d.toLocaleDateString('ar-IQ', { month: 'long', year: 'numeric' }) }; } },
  weekday: { name: 'يوم الأسبوع', f: (c) => { const i = dayIdx(new Date(c.createdMs)); return { k: i, l: DAYS_AR[i] }; } },
  daypart: { name: 'فترة اليوم', f: (c) => {
    const hr = new Date(c.createdMs).getHours();
    return hr < 6 ? { k: 0, l: 'الفجر (12 ص – 6 ص)' } : hr < 12 ? { k: 1, l: 'الصباح (6 ص – 12 ظ)' } : hr < 17 ? { k: 2, l: 'بعد الظهر (12 – 5 م)' } : hr < 21 ? { k: 3, l: 'المساء (5 – 9 م)' } : { k: 4, l: 'الليل (9 م – 12 ص)' };
  } },
  dept: { name: 'القسم', f: (c) => ({ k: c.department || '~', l: c.department || 'غير موجّهة' }) },
  status: { name: 'الحالة', f: (c) => ({ k: ORD(['new', 'routed', 'in_progress', 'pending_review', 'resolved'], c.status), l: STATUS[c.status] || c.status }) },
  priority: { name: 'الأولوية', f: (c) => ({ k: ORD(['urgent', 'high', 'medium', 'low'], c.priority), l: 'أولوية ' + (PRI[c.priority] || 'غير محددة') }) },
  crew: { name: 'الكادر', f: (c) => ({ k: c.crew || '~', l: c.crew ? '🚧 ' + c.crew : 'بدون كادر' }) },
  sector: { name: 'القاطع', f: (c) => { const n = sectorOf(c); return { k: n || '~', l: sectorLabel(n) }; } },
  branch: { name: 'الفرع', f: (c) => ({ k: c.branch || '~', l: c.branch || 'بدون فرع' }) },
  speed: { name: 'سرعة الإنجاز', f: speedOf },
  rating: { name: 'تقييم المواطن', f: (c) => c.rating ? { k: 5 - c.rating, l: '⭐'.repeat(c.rating) + ' (' + c.rating + ')' } : { k: 9, l: 'لم يُقيَّم' } },
  confirm: { name: 'تأكيد المواطن', f: (c) => c.reopenCount && c.status !== 'resolved' ? { k: 1, l: '🔁 أُعيد فتحها (قيد المعالجة)' } : c.status !== 'resolved' ? { k: 4, l: 'غير منجزة' } : c.confirmed ? { k: 0, l: '✔ أكّد المواطن الإنجاز' } : { k: 2, l: '⏳ منجزة بانتظار تأكيد المواطن' } },
  dup: { name: 'المكررة', f: (c) => c.dupTitle ? { k: 1, l: '🔁 شكاوى مكررة' } : c.dupCount ? { k: 0, l: '📌 شكاوى تكررت (الأصلية)' } : { k: 2, l: 'عادية' } },
};
let cls = { by: 'day', status: 'all', dept: 'all', from: '', to: '', q: '' };
let doneF = { dept: 'all', from: '', to: '', q: '', img: false };

const allDepts = () => [...new Set([...(settings.departments || []), ...list.map((c) => c.department).filter(Boolean)])];
const dateMs = (s, end) => (s ? new Date(s + (end ? 'T23:59:59' : 'T00:00:00')).getTime() : 0);

function sel(opts, value, onch) {
  const s = h('select', { onchange: (e) => onch(e.target.value) }, ...opts.map(([k, l]) => h('option', { value: k }, l)));
  s.value = value;
  return s;
}
function field(label, el) { return h('label', {}, label, h('br'), el); }
function textBox(value, onin) { return h('input', { type: 'text', value, placeholder: 'بحث…', oninput: (e) => onin(e.target.value), onchange: () => render() }); }

function renderClassify() {
  const depts = allDepts();
  const bar = h('div', { class: 'card bar' },
    field('صنّف حسب', sel(Object.entries(CLS).map(([k, v]) => [k, v.name]), cls.by, (v) => { cls.by = v; render(); })),
    field('الحالة', sel([['all', 'الكل'], ...Object.entries(STATUS)], cls.status, (v) => { cls.status = v; render(); })),
    field('القسم', sel([['all', 'كل الأقسام'], ...depts.map((d) => [d, d])], cls.dept, (v) => { cls.dept = v; render(); })),
    field('من تاريخ', h('input', { type: 'date', value: cls.from, onchange: (e) => { cls.from = e.target.value; render(); } })),
    field('إلى تاريخ', h('input', { type: 'date', value: cls.to, onchange: (e) => { cls.to = e.target.value; render(); } })),
    field('بحث', textBox(cls.q, (v) => { cls.q = v; })));
  const f = dateMs(cls.from), t = dateMs(cls.to, true), q = cls.q.trim().toLowerCase();
  const items = list.filter((c) =>
    (cls.status === 'all' || c.status === cls.status) &&
    (cls.dept === 'all' || c.department === cls.dept) &&
    (!f || c.createdMs >= f) && (!t || c.createdMs <= t) &&
    (!q || (c.title + ' ' + c.text + ' ' + c.name).toLowerCase().includes(q)));
  const def = CLS[cls.by];
  const groups = new Map();
  items.forEach((c) => {
    const g = def.f(c);
    if (!groups.has(g.l)) groups.set(g.l, { k: g.k, l: g.l, items: [] });
    groups.get(g.l).items.push(c);
  });
  const sorted = [...groups.values()].sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0) * (def.desc ? -1 : 1));
  const out = [bar, h('div', { class: 'sum' },
    h('span', { class: 'chip' }, 'الشكاوى: ' + items.length),
    h('span', { class: 'chip' }, 'المجموعات: ' + sorted.length),
    h('span', { class: 'chip ok' }, 'المنجزة: ' + items.filter((c) => c.status === 'resolved').length),
    h('span', { class: 'chip warn' }, 'غير المنجزة: ' + items.filter((c) => c.status !== 'resolved').length))];
  if (!sorted.length) out.push(h('div', { class: 'empty' }, 'لا توجد شكاوى مطابقة'));
  sorted.forEach((g) => g.items.sort((a, b) => b.createdMs - a.createdMs));
  // تقسيم الشكاوى (بترتيب المجموعات) إلى صفحات ثم إعادة تجميع كل صفحة
  const flat = sorted.flatMap((g) => g.items.map((c) => ({ g, c })));
  const pg = paginate('classify', flat, JSON.stringify(cls));
  out.push(pg.bar());
  const shownGroups = [];
  pg.slice.forEach((x) => {
    const last = shownGroups[shownGroups.length - 1];
    if (last && last.g === x.g) last.items.push(x.c); else shownGroups.push({ g: x.g, items: [x.c] });
  });
  shownGroups.forEach((s, i) => {
    const done = s.g.items.filter((c) => c.status === 'resolved').length;
    const d = h('details', { class: 'grp' },
      h('summary', {}, s.g.l + ' — ' + s.g.items.length + ' شكوى (منجزة ' + done + ')' + (s.items.length < s.g.items.length ? ' • المعروض في هذه الصفحة ' + s.items.length : '')),
      ...s.items.map(card));
    d.open = i < 3;
    out.push(d);
  });
  if (flat.length) out.push(pg.bar());
  return out;
}

// ---------------- الأعمال المنجزة (مع صور قبل وبعد) ----------------
function renderDone() {
  const bar = h('div', { class: 'card bar' },
    field('القسم', sel([['all', 'كل الأقسام'], ...allDepts().map((d) => [d, d])], doneF.dept, (v) => { doneF.dept = v; render(); })),
    field('أُنجزت من', h('input', { type: 'date', value: doneF.from, onchange: (e) => { doneF.from = e.target.value; render(); } })),
    field('إلى', h('input', { type: 'date', value: doneF.to, onchange: (e) => { doneF.to = e.target.value; render(); } })),
    field('بحث', textBox(doneF.q, (v) => { doneF.q = v; })),
    field('الفرز', sel(Object.entries(DONE_SORTS).map(([k, x]) => [k, x[0]]), doneSort, (v) => { doneSort = v; render(); })),
    h('label', {}, h('input', { type: 'checkbox', checked: doneF.img, onchange: (e) => { doneF.img = e.target.checked; render(); } }), ' مع صورة بعد الصيانة فقط'));
  const f = dateMs(doneF.from), t = dateMs(doneF.to, true), q = doneF.q.trim().toLowerCase();
  const items = list.filter((c) => c.status === 'resolved' &&
    (doneF.dept === 'all' || c.department === doneF.dept) &&
    (!doneF.img || c.afterImageB64) &&
    (!f || (c.resolvedMs || c.createdMs) >= f) && (!t || (c.resolvedMs || c.createdMs) <= t) &&
    (!q || (c.title + ' ' + c.text + ' ' + c.reply + ' ' + c.crew).toLowerCase().includes(q)))
    .sort(DONE_SORTS[doneSort][1]);
  const withImg = items.filter((c) => c.afterImageB64).length;
  const out = [bar, h('div', { class: 'sum' },
    h('span', { class: 'chip ok' }, 'الأعمال المنجزة: ' + items.length),
    h('span', { class: 'chip' }, 'مع صورة بعد الصيانة: ' + withImg))];
  if (!items.length) out.push(h('div', { class: 'empty' }, 'لا توجد أعمال منجزة مطابقة'));
  const pg = paginate('done', items, JSON.stringify(doneF) + doneSort);
  if (items.length) out.push(pg.bar());
  pg.slice.forEach((c) => {
    out.push(h('div', { class: 'card' },
      h('h3', {}, '✅ ' + c.title),
      h('small', {}, [c.department, c.crew ? 'الكادر: ' + crewLabel(c) : '', c.branch ? 'الفرع: ' + c.branch : '', sectorOf(c) ? 'القاطع: ' + sectorOf(c) : ''].filter(Boolean).join(' • ')),
      h('p', { class: 'small' }, (c.resolvedMs ? 'أُنجزت: ' + fmtT(c.resolvedMs) + ' • مدة الإنجاز: ' + fmtD(c.resolvedMs - workStart(c)) : 'وقت الإنجاز غير مسجّل') + (c.rating ? ' • التقييم: ' + '⭐'.repeat(c.rating) : '') + (c.confirmed ? ' • ✔ أكّد المواطن' : ' • ⏳ لم يؤكد المواطن بعد') + (c.reopenCount ? ' • 🔁 أُعيد فتحها ' + c.reopenCount + ' مرة' : '')),
      c.reply ? h('p', { class: 'reply' }, 'ملخص العمل: ' + c.reply) : '',
      (c.materials && c.repairable) ? h('p', { class: 'small' }, 'المواد: ' + c.materials) : '',
      c.voiceB64 ? voiceBox(c) : '',
      (c.imageB64 || c.afterImageB64) ? h('div', { class: 'ba' },
        c.imageB64 ? h('figure', {}, h('figcaption', {}, 'قبل (من المواطن)'), h('img', { src: 'data:image/jpeg;base64,' + c.imageB64 })) : '',
        c.afterImageB64 ? h('figure', {}, h('figcaption', {}, 'بعد الصيانة'), h('img', { src: 'data:image/jpeg;base64,' + c.afterImageB64 })) : '') : '',
      c.lat !== null ? h('button', { class: 'act', onclick: () => window.api.openMap(c.lat, c.lng) }, '📍 الموقع') : '',
      logButton(c.id)));
  });
  if (items.length) out.push(pg.bar());
  return out;
}

// ---------------- كوادر الأقسام (أسماء الكوادر لإسناد الشكاوى) ----------------
// نافذة تأكيد داخل الصفحة (بدل confirm الأصلي الذي يُجمّد حقول الإدخال في Electron على ويندوز)
function askConfirm(msg) {
  return new Promise((resolve) => {
    const done = (v) => { ov.remove(); resolve(v); };
    const ok = h('button', { class: 'act', onclick: () => done(true) }, 'نعم، احذف');
    const no = h('button', { class: 'act', onclick: () => done(false) }, 'إلغاء');
    const box = h('div', { class: 'card', style: 'max-width:420px;margin:0;white-space:pre-line;text-align:right' }, msg, h('div', { class: 'bar', style: 'margin-top:14px' }, ok, no));
    const ov = h('div', { style: 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999', onclick: (e) => { if (e.target === ov) done(false); } }, box);
    document.body.append(ov); no.focus();
  });
}
let crewAdd = { department: '', names: '', count: '1', msg: '' };
// صف حساب: الاسم + كلمة مرور جديدة + تعطيل/تفعيل + حذف
function accountRow(s, label) {
  const nm = h('input', { type: 'text', value: s.name || '', placeholder: 'الاسم' });
  const pw = h('input', { type: 'text', placeholder: 'كلمة مرور جديدة' });
  const st = h('span', { class: 'small' });
  const run = async (p, okText) => { st.textContent = '...'; const r = await p; st.textContent = r.ok ? '✅ ' + okText : '❌ ' + r.error; return r; };
  return h('div', { class: s.disabled ? 'card' : 'card' },
    h('b', {}, label + (s.disabled ? '  ⛔ معطَّل' : '')),
    h('div', { class: 'bar' },
      nm, h('button', { class: 'act', onclick: () => run(window.api.setStaffName(s.id, nm.value), 'حُفظ الاسم') }, 'حفظ الاسم'),
      pw, h('button', { class: 'act', onclick: () => run(window.api.setStaffPassword(s.id, pw.value), 'تم تغيير كلمة المرور').then((r) => { if (r.ok) pw.value = ''; }) }, 'تغيير كلمة المرور'),
      h('button', { class: 'act', onclick: () => run(window.api.setStaffDisabled(s.id, !s.disabled), s.disabled ? 'تم التفعيل' : 'تم التعطيل') }, s.disabled ? 'تفعيل الحساب' : 'تعطيل الحساب'),
      ...(s.role === 'crew' && s.sector ? [(() => { let sel = [...(s.areas || [])]; return h('div', { class: 'area-edit' }, h('b', {}, 'المناطق:'), areaPicker(s.departments[0], s.sector, sel, (v) => { sel = v; }), h('button', { class: 'act', onclick: () => run(window.api.setStaffAreas(s.id, sel), 'حُفظت المناطق') }, 'حفظ المناطق')); })()] : []),
      h('button', { class: 'act', onclick: async () => {
        if (!(await askConfirm('حذف هذا الحساب نهائياً؟\n' + label + '\n(لا يحذف الشكاوى السابقة)'))) return;
        const r = await run(window.api.deleteStaff(s.id), 'تم الحذف');
        if (r && r.ok) {
          // إزالة نتيجة الإنشاء القديمة المطابقة لهذا الحساب من قائمة «تم إنشاء ...»
          crewForm.results = (crewForm.results || []).filter((x) => x.email !== s.email);
          if (!crewForm.results.length) crewForm.msg = '';
          render();
        }
      } }, '🗑 حذف'), st));
}
let deptCrews = [];
let deptStaffForm = { department: '', sector: '', name: '', email: '', password: '', msg: '' };
function deptStaffCard() {
  const depts = allDepts();
  if (!deptStaffForm.department && depts.length) deptStaffForm.department = depts[0];
  const f = deptStaffForm;
  const inp = (key, ph) => h('input', { type: 'text', placeholder: ph, value: f[key], oninput: (e) => { f[key] = e.target.value; } });
  const msg = h('div', { class: 'small' }, f.msg);
  const accounts = staff.filter((s) => s.role !== 'crew');
  return h('div', { class: 'card' },
    h('h3', {}, '👤 إنشاء حساب موظف قسم'),
    h('p', { class: 'small' }, 'الحساب الذي يستلم شكاوى القسم ويُسند الكوادر.'),
    h('div', { class: 'bar' },
      field('القسم', sel(depts.map((d) => [d, d]), f.department, (v) => { f.department = v; f.sector = ''; render(); })),
      field('القاطع', sel([['', 'بدون قاطع'], ...sectorsOf(f.department).map((x) => [x.name, x.name])], f.sector, (v) => { f.sector = v; })),
      field('الاسم (اختياري)', inp('name', 'اسم الموظف')),
      field('البريد', inp('email', 'staff@example.com')),
      field('كلمة المرور', inp('password', '6 أحرف على الأقل')),
      h('button', { class: 'act', onclick: async () => {
        msg.textContent = 'جارٍ الإنشاء...';
        const r = await window.api.createDeptStaff({ ...f });
        f.msg = r.ok ? '✅ تم إنشاء الحساب' : '❌ ' + r.error;
        if (r.ok) { f.name = ''; f.email = ''; f.password = ''; f.sector = ''; }
        render();
      } }, 'إنشاء')),
    msg,
    accounts.length ? h('div', {}, h('b', {}, 'حسابات الموظفين:'),
      ...[...new Set(accounts.map((s) => (s.departments[0] || '') + '\u0001' + (s.sector || '')))].sort().map((key) => {
        const [d, sc] = key.split('\u0001');
        return sectorGroup(d, sc, accounts.filter((s) => (s.departments[0] || '') === d && (s.sector || '') === sc)
          .map((s) => accountRow(s, (s.name || s.email || '-') + (s.name && s.email ? ' • ' + s.email : ''))));
      })) : '');
}
// ---------------- القواطع (قسم ← قاطع ← مناطق) ----------------
// مثال: قسم البلدية ← قاطع الكرادة ← (الكرادة داخل، السعدون، ...). تُحفظ في الإعدادات.
// عنوان مجموعة قاطع: أيقونة + اسم القسم والقاطع + عدد الحسابات، والحسابات داخل إطار واحد
// اختيار مناطق الكادر من مناطق قاطعه (مربعات اختيار)
function areaPicker(dept, sector, selected, onChange) {
  const sec = sectorsOf(dept).find((x) => x.name === sector);
  if (!sec || !sec.areas.length) return h('span', { class: 'small' }, sector ? 'لا توجد مناطق في هذا القاطع بعد' : 'اختر قاطعاً لتحديد المناطق');
  const set = new Set(selected);
  const box = (a) => h('label', { class: 'area-pick' }, h('input', { type: 'checkbox', checked: set.has(a), onchange: (e) => { e.target.checked ? set.add(a) : set.delete(a); onChange([...set]); } }), ' ' + a);
  return h('div', { class: 'area-picks' },
    h('label', { class: 'area-pick all' }, h('input', { type: 'checkbox', checked: sec.areas.every((a) => set.has(a)), onchange: (e) => { const on = e.target.checked; e.target.closest('.area-picks').querySelectorAll('input').forEach((i) => { i.checked = on; }); set.clear(); if (on) sec.areas.forEach((a) => set.add(a)); onChange([...set]); } }), ' كل المناطق'),
    ...sec.areas.map(box));
}
// حفظ قائمة القواطع في الإعدادات
async function saveSectors(list2, okText) {
  settings = { ...settings, sectors: list2 };
  await window.api.setSettings(settings);
  sectorForm.msg = '✅ ' + okText; render();
}
// حذف قاطع كامل بمناطقه؛ حسابات الكوادر التابعة له تنتقل إلى «بدون قاطع» ولا تُحذف
async function deleteSector(dept, name) {
  const n = staff.filter((s) => s.role === 'crew' && (s.sector || '') === name && s.departments.includes(dept)).length;
  if (!(await askConfirm('حذف القاطع «' + name + '» ومناطقه من ' + dept + '؟' + (n ? '\nستنتقل ' + n + ' حساب كادر إلى «بدون قاطع».' : '') + '\n(لا يحذف الحسابات ولا الشكاوى)'))) return;
  if (n) { const r = await window.api.clearSector(dept, name); if (!r.ok) { sectorForm.msg = '❌ ' + r.error; return render(); } }
  await saveSectors((settings.sectors || []).filter((y) => !(y.dept === dept && y.name === name)), 'تم حذف القاطع');
}
// حذف منطقة واحدة من قاطع
async function removeArea(dept, name, area) {
  if (!(await askConfirm('حذف المنطقة «' + area + '» من القاطع «' + name + '»؟'))) return;
  await window.api.removeAreaFromCrews(dept, name, area);
  await saveSectors((settings.sectors || []).map((y) => (y.dept === dept && y.name === name ? { ...y, areas: y.areas.filter((a) => a !== area) } : y)), 'تم حذف المنطقة');
}
// شارة منطقة قابلة للحذف
const areaChip = (dept, name, a) => h('span', { class: 'area' }, a + (() => { const n = staff.filter((s) => s.role === 'crew' && (s.sector || '') === name && s.departments.includes(dept) && (s.areas || []).includes(a)).length; return n ? ' (' + n + ' كادر)' : ''; })() + ' ',
  h('a', { href: '#', class: 'ax', title: 'حذف المنطقة', onclick: (e) => { e.preventDefault(); removeArea(dept, name, a); } }, '✖'));
// عنوان مجموعة قاطع: أيقونة + اسم القسم والقاطع + عدد الحسابات + حذف القاطع، ثم المناطق القابلة للحذف
function sectorGroup(dept, sc, cards) {
  const sec = sc ? sectorsOf(dept).find((x) => x.name === sc) : null;
  return h('div', { class: 'sec-group' },
    h('div', { class: 'sec-head' + (sc ? '' : ' none') },
      h('div', { class: 'sec-ico' }, sc ? '🗺' : '📂'),
      h('div', { class: 'sec-title' }, h('b', {}, sc || 'بدون قاطع'), h('small', {}, dept || '-')),
      h('span', { class: 'sec-count' }, String(cards.length)),
      sec ? h('a', { href: '#', class: 'sec-del', title: 'حذف القاطع', onclick: (e) => { e.preventDefault(); deleteSector(dept, sc); } }, '🗑 حذف القاطع') : ''),
    sec ? h('div', { class: 'sec-areas' }, ...(sec.areas.length ? sec.areas.map((a) => areaChip(dept, sc, a)) : [h('span', { class: 'none' }, 'لم تُحدَّد مناطق')])) : '',
    h('div', { class: 'sec-body' }, ...cards));
}
let sectorForm = { department: '', name: '', areas: '', msg: '' };
const sectorsOf = (dept) => (settings.sectors || []).filter((x) => x.dept === dept);
// القاطع الذي تنتمي إليه شكوى: يطابق اسم القاطع أو إحدى مناطقه في الفرع/العنوان/نص الشكوى
function sectorOf(c) {
  // اختيار المواطن للحي له الأولوية على مطابقة النص
  const mine = sectorsOf(c.department);
  const byPick = mine.find((x) => (c.sector && x.name === c.sector && (!c.area || x.areas.includes(c.area))) || (c.area && x.areas.includes(c.area)));
  if (byPick) return byPick.name;
  const hay = [c.branch, c.title, c.text].filter(Boolean).join(' ');
  const hit = sectorsOf(c.department).find((x) => [x.name, ...x.areas].some((a) => a && hay.includes(a)));
  return hit ? hit.name : '';
}
const sectorLabel = (name) => (name ? '🗺 ' + name : 'بدون قاطع');
// أزرار اختيار القسم (مشتركة بين نظرة عامة والقواطع)
function deptPills() {
  const depts = allDepts();
  if (!sectorForm.department && depts.length) sectorForm.department = depts[0];
  return h('div', { class: 'pills' }, h('span', { class: 'small' }, 'القسم:'),
    ...depts.map((d) => h('button', { class: 'pill' + (d === sectorForm.department ? ' on' : ''), onclick: () => { sectorForm.department = d; render(); } }, d)));
}
function sectorManager() {
  const depts = allDepts();
  if (!sectorForm.department && depts.length) sectorForm.department = depts[0];
  const f = sectorForm, d = f.department;
  const msg = h('div', { class: 'small' }, f.msg);
  const secs = sectorsOf(d);
  const crewsIn = (name) => staff.filter((s) => s.role === 'crew' && (s.sector || '') === name && s.departments.includes(d)).length;
  return h('div', { class: 'card' },
    h('h3', {}, '🗺 القواطع والمناطق'),
    deptPills(),
    h('div', { class: 'panel' },
      h('b', {}, '➕ إضافة قاطع إلى «' + (d || '-') + '»'),
      h('div', { class: 'bar' },
        field('اسم القاطع', h('input', { type: 'text', placeholder: 'مثال: قاطع الكرادة', value: f.name, oninput: (e) => { f.name = e.target.value; } })),
        field('المناطق (افصل بفاصلة)', h('input', { type: 'text', placeholder: 'منطقة 1، منطقة 2', value: f.areas, oninput: (e) => { f.areas = e.target.value; } })),
        h('button', { class: 'act', onclick: async () => {
          const name = f.name.trim(), areas = f.areas.split(/[،,;؛\n]/).map((v) => v.trim()).filter(Boolean);
          if (!name) { f.msg = 'اكتب اسم القاطع'; return render(); }
          const rest = (settings.sectors || []).filter((x) => !(x.dept === d && x.name === name));
          const old = (settings.sectors || []).find((x) => x.dept === d && x.name === name);
          f.name = ''; f.areas = '';
          await saveSectors([...rest, { dept: d, name, areas: [...new Set([...(old ? old.areas : []), ...areas])] }], 'تم حفظ القاطع');
        } }, 'إضافة / تحديث')),
      h('p', { class: 'small' }, 'إذا كان القاطع موجوداً تُضاف المناطق الجديدة إلى مناطقه. تُصنَّف الشكوى تلقائياً إلى القاطع إذا ورد اسمه أو إحدى مناطقه في فرعها أو عنوانها أو نصها.')),
    msg,
    secs.length ? h('div', { class: 'sec-grid' },
      ...secs.map((x) => h('div', { class: 'sec-card' },
        h('b', {}, '🗺 ' + x.name),
        h('div', { class: 'small' }, x.areas.length + ' منطقة • ' + crewsIn(x.name) + ' كادر'),
        h('div', { class: 'areas' }, ...(x.areas.length ? x.areas.map((a) => areaChip(d, x.name, a)) : [h('span', { class: 'none' }, 'لم تُحدَّد مناطق')])),
        h('button', { class: 'act sec-del-btn', title: 'حذف القاطع', onclick: (e) => { e.preventDefault(); deleteSector(d, x.name); } }, '🗑 حذف القاطع'))))
      : h('div', { class: 'empty' }, 'لا توجد قواطع في هذا القسم بعد — أضف أول قاطع من النموذج أعلاه'));
}

// ---------------- نظرة عامة: قسم ← قاطع ← مناطق ← كوادر ----------------
function overviewPanel() {
  const d = sectorForm.department;
  if (!d) return h('div', { class: 'empty' }, 'لا توجد أقسام بعد');
  const crews = staff.filter((s) => s.role === 'crew' && s.departments.includes(d));
  const secs = sectorsOf(d);
  const coverOf = (inSec, a) => inSec.filter((s) => (s.areas || []).includes(a));
  const allAreas = secs.reduce((n, x) => n + x.areas.length, 0);
  const uncovered = secs.reduce((n, x) => n + x.areas.filter((a) => !coverOf(crews.filter((s) => (s.sector || '') === x.name), a).length).length, 0);
  const loose = crews.filter((s) => !s.sector || !secs.some((x) => x.name === s.sector));
  const chip = (s) => h('span', { class: 'chip' + (s.disabled ? ' warn' : '') }, '🚧 ' + s.crew + (s.name ? ' (' + s.name + ')' : ''));
  const steps = h('div', { class: 'steps' },
    h('span', {}, '① أضف القواطع ومناطقها'), h('span', {}, '② أنشئ حسابات الكوادر داخل القاطع'), h('span', {}, '③ حدّد المناطق التي يغطيها كل كادر'));
  const kpi = h('div', { class: 'sum' },
    h('span', { class: 'chip' }, '🗺 قواطع: ' + secs.length),
    h('span', { class: 'chip' }, '📍 مناطق: ' + allAreas),
    h('span', { class: 'chip' }, '🚧 كوادر: ' + crews.length),
    h('span', { class: 'chip ' + (uncovered ? 'warn' : 'ok') }, uncovered ? '⚠ مناطق بلا كادر: ' + uncovered : '✅ كل المناطق مغطاة'));
  const blocks = secs.map((x) => {
    const inSec = crews.filter((s) => (s.sector || '') === x.name);
    const noArea = inSec.filter((s) => !(s.areas || []).length);
    return h('div', { class: 'sec-group' },
      h('div', { class: 'sec-head' }, h('div', { class: 'sec-ico' }, '🗺'),
        h('div', { class: 'sec-title' }, h('b', {}, x.name), h('small', {}, d)),
        h('span', { class: 'sec-count' }, inSec.length + ' كادر')),
      h('div', { class: 'sec-body' },
        ...x.areas.map((a) => { const c = coverOf(inSec, a); return h('div', { class: 'area-row' + (c.length ? '' : ' miss') }, h('b', {}, '📍 ' + a), h('div', {}, ...(c.length ? c.map(chip) : [h('span', { class: 'small' }, '⚠ لا يوجد كادر يغطي هذه المنطقة')]))); }),
        !x.areas.length ? h('p', { class: 'small' }, 'لم تُحدَّد مناطق لهذا القاطع') : '',
        noArea.length ? h('div', { class: 'area-row' }, h('b', {}, '🧩 كوادر القاطع دون تحديد مناطق'), h('div', {}, ...noArea.map(chip))) : ''));
  });
  return h('div', {}, deptPills(), kpi,
    secs.length ? '' : steps,
    ...blocks,
    loose.length ? h('div', { class: 'sec-group' },
      h('div', { class: 'sec-head none' }, h('div', { class: 'sec-ico' }, '📂'), h('div', { class: 'sec-title' }, h('b', {}, 'بدون قاطع'), h('small', {}, d)), h('span', { class: 'sec-count' }, loose.length + ' كادر')),
      h('div', { class: 'sec-body' }, h('div', { class: 'area-row' }, h('div', {}, ...loose.map(chip))))) : '',
    !secs.length && !loose.length ? h('div', { class: 'empty' }, 'لا توجد قواطع ولا كوادر في هذا القسم بعد') : '');
}

// ---------------- صفحة التوزيع والإعداد (تبويبات فرعية) ----------------
let setupTab = 'overview';
const SETUP_TABS = [['overview', '🧭 نظرة عامة'], ['sectors', '🗺 القواطع والمناطق'], ['crews', '🚧 الكوادر وحساباتهم'], ['staff', '👥 موظفو الأقسام']];
function renderSetup() {
  const bar = h('div', { class: 'subtabs' }, ...SETUP_TABS.map(([k, l]) => h('button', { class: 'subtab' + (k === setupTab ? ' on' : ''), onclick: () => { setupTab = k; render(); } }, l)));
  const body = setupTab === 'overview' ? [overviewPanel()] : setupTab === 'sectors' ? [sectorManager()] : setupTab === 'crews' ? [crewManager(), crewAccounts()] : [deptStaffCard()];
  return [bar, ...body];
}
function crewManager() {
  const depts = allDepts();
  if (!crewAdd.department && depts.length) crewAdd.department = depts[0];
  const msg = h('div', { class: 'small' }, crewAdd.msg);
  const namesOf = (dept) => [...new Set([
    ...deptCrews.filter((x) => x.dept === dept).flatMap((x) => x.crews),
    ...staff.filter((s) => s.role !== 'crew' && s.departments.includes(dept)).flatMap((s) => s.crews || []),
  ])];
  const names = h('input', { type: 'text', placeholder: 'كادر 1، كادر 2، كادر 3', value: crewAdd.names, oninput: (e) => { crewAdd.names = e.target.value; } });
  return h('div', { class: 'card' },
    h('h3', {}, '🧰 كوادر الأقسام'),
    h('p', { class: 'small' }, 'أضف أسماء الكوادر التي يُسنِد إليها موظفو القسم الشكاوى. تُحفظ مباشرة وتظهر في قائمة الإسناد في تطبيق الموظف عند فتحه (دون الدخول إلى Firebase).'),
    h('div', { class: 'bar' },
      field('القسم', sel(depts.map((d) => [d, d]), crewAdd.department, (v) => { crewAdd.department = v; })),
      field('أسماء الكوادر (افصل بفاصلة)', names),
      field('العدد (يُرقِّم الاسم: كادر ← كادر 1، كادر 2…)', h('input', { type: 'number', min: '1', max: '50', value: crewAdd.count, oninput: (e) => { crewAdd.count = e.target.value; } })),
      h('button', { class: 'act', onclick: async () => {
        let list2 = crewAdd.names.split(/[،,;؛\n]/).map((v) => v.trim()).filter(Boolean);
        if (!list2.length) { crewAdd.msg = 'اكتب اسماً واحداً على الأقل'; return render(); }
        const cnt = Math.max(1, Math.min(50, parseInt(crewAdd.count, 10) || 1));
        // العدد > 1: كل اسم يُرقَّم (كادر ← كادر 1 … كادر N) بنفس صيغة إنشاء الحسابات
        if (cnt > 1) list2 = list2.flatMap((k) => Array.from({ length: cnt }, (_, i) => k + ' ' + (i + 1)));
        msg.textContent = 'جارٍ الحفظ...';
        const r = await window.api.editCrews(crewAdd.department, list2, []);
        crewAdd.msg = r.ok ? '✅ تمت الإضافة' : '❌ ' + r.error;
        if (r.ok) { crewAdd.names = ''; crewAdd.count = '1'; }
        render();
      } }, 'إضافة')),
    msg,
    ...depts.map((d) => {
      const ns = namesOf(d);
      return ns.length ? h('div', { class: 'sum' }, h('b', {}, d + ': '),
        ...ns.map((k) => h('span', { class: 'chip' }, '🚧 ' + k + ' ',
          h('a', { href: '#', title: 'حذف من القائمة', onclick: async (e) => {
            e.preventDefault();
            if (!(await askConfirm('حذف «' + k + '» من كوادر ' + d + '؟ (لا يحذف حساب الكادر ولا شكاواه)'))) return;
            const r = await window.api.editCrews(d, [], [k]);
            crewAdd.msg = r.ok ? '✅ تم الحذف' : '❌ ' + r.error; render();
          } }, '✖')))) : '';
    }));
}

// ---------------- حسابات الكوادر ----------------
let crewForm = { department: '', sector: '', areas: [], crew: '', name: '', email: '', password: '', count: '1', msg: '', results: [] };
// اسم المسؤول عن الكادر (من حساب الكادر) لعرضه بجانب اسم الكادر
function crewLabel(c) {
  if (!c.crew) return '';
  const a = staff.find((s) => s.role === 'crew' && s.crew === c.crew && s.departments.includes(c.department));
  return c.crew + (a && a.name ? ' (' + a.name + ')' : '');
}
// أسماء كوادر القسم المُضافة في «كوادر الأقسام»
function deptCrewNames(dept) {
  return [...new Set([
    ...deptCrews.filter((x) => x.dept === dept).flatMap((x) => x.crews),
    ...staff.filter((s) => s.role !== 'crew' && s.departments.includes(dept)).flatMap((s) => s.crews || []),
  ])];
}
// أسماء كوادر القسم التي لم يُنشأ لها حساب بعد
function freeCrewNames(dept) {
  const have = new Set(staff.filter((s) => s.role === 'crew' && s.departments.includes(dept)).map((s) => s.crew));
  return deptCrewNames(dept).filter((k) => !have.has(k));
}
function crewAccounts() {
  const depts = allDepts();
  if (!crewForm.department && depts.length) crewForm.department = depts[0];
  const msg = h('div', { class: 'small' }, crewForm.msg);
  const inp = (key, ph, type) => h('input', { type: type || 'text', placeholder: ph, value: crewForm[key], oninput: (e) => { crewForm[key] = e.target.value; } });
  const accounts = staff.filter((s) => s.role === 'crew');
  return h('div', { class: 'card' },
    h('h3', {}, '➕ إنشاء حساب كادر ميداني'),
    h('p', { class: 'small' }, 'يرى حساب الكادر شكاواه المُسندة إليه فقط، ويضغط «وصلت إلى الموقع» ثم يرسل الإنجاز.'),
    h('div', { class: 'bar' },
      field('القسم', sel(depts.map((d) => [d, d]), crewForm.department, (v) => { crewForm.department = v; crewForm.sector = ''; crewForm.areas = []; render(); })),
      field('القاطع', sel([['', 'بدون قاطع'], ...sectorsOf(crewForm.department).map((x) => [x.name, x.name])], crewForm.sector, (v) => { crewForm.sector = v; crewForm.areas = []; render(); })),
      field('المناطق التي يغطيها', areaPicker(crewForm.department, crewForm.sector, crewForm.areas, (v) => { crewForm.areas = v; })),
      field('اسم الكادر (اختر من كوادر القسم)', (() => {
        // الأسماء المُضافة في «كوادر الأقسام» والتي لا يوجد لها حساب بعد؛ الاختيار فقط لضمان المطابقة حرفاً بحرف
        const free = freeCrewNames(crewForm.department);
        if (crewForm.crew && crewForm.crew !== '__all__' && !free.includes(crewForm.crew)) crewForm.crew = '';
        if (!crewForm.crew && free.length) crewForm.crew = free[0];
        if (!free.length) return h('div', { class: 'small' }, '⚠️ لا توجد كوادر بلا حساب في هذا القسم. أضِف الأسماء أولاً من «كوادر الأقسام».');
        return sel([...free.map((k) => [k, k]), ...(free.length > 1 ? [['__all__', '⭐ كل الكوادر بلا حساب (' + free.length + ') — يُرقَّم البريد']] : [])], crewForm.crew, (v) => { crewForm.crew = v; render(); });
      })()),
      field('اسم المسؤول (اختياري)', inp('name', 'مثال: أحمد علي')),
      field(crewForm.crew === '__all__' ? 'البريد (أساسه: crew@… ← crew1@…)' : 'البريد', inp('email', 'crew@example.com')),
      field('كلمة المرور (للجميع)', inp('password', '6 أحرف على الأقل', 'text')),
      h('button', { class: 'act', onclick: async () => {
        msg.textContent = 'جارٍ الإنشاء...';
        if (!crewForm.crew) { crewForm.msg = '❌ اختر اسم الكادر من القائمة'; return render(); }
        let r;
        if (crewForm.crew === '__all__') {
          // إنشاء حساب لكل كادر بلا حساب؛ رقم البريد = ترتيب الكادر في قائمة القسم (لا يتكرر)
          const all = deptCrewNames(crewForm.department), free = freeCrewNames(crewForm.department);
          const em = String(crewForm.email || '').trim().toLowerCase();
          if (!em.includes('@')) { crewForm.msg = '❌ أدخل بريداً صحيحاً'; return render(); }
          const [loc, dom] = em.split('@');
          r = { ok: true, error: '', results: [] };
          for (const k of free) {
            const one = await window.api.createCrew({ ...crewForm, crew: k, count: '1', name: '', email: loc + (all.indexOf(k) + 1) + '@' + dom });
            r.results.push(...(one.results || []));
            if (!one.ok) { r.ok = false; r.error = one.error; }
          }
        } else {
          r = await window.api.createCrew({ ...crewForm, count: '1' });
        }
        crewForm.msg = r.ok ? '✅ تم إنشاء ' + r.results.length + ' حساب' : '❌ ' + (r.error || 'فشل');
        crewForm.results = r.results || [];
        if (r.ok) { crewForm.crew = ''; crewForm.name = ''; crewForm.email = ''; crewForm.password = ''; crewForm.count = '1'; crewForm.areas = []; }
        render();
      } }, 'إنشاء')),
    h('p', { class: 'small' }, 'الأسماء تُضاف من «كوادر الأقسام» (مع خانة العدد للترقيم التلقائي)، وهنا تختارها من القائمة فيُضمن تطابقها مع الشكاوى المُسندة. خيار «كل الكوادر بلا حساب» ينشئ لكل كادر حساباً ببريد مُرقَّم (crew1@، crew2@…) وكلمة المرور نفسها.'),
    msg,
    ...crewForm.results.map((r) => h('div', { class: r.ok ? 'rep yes' : 'rep no' }, (r.ok ? '✅ ' : '❌ ') + r.crew + ' — ' + r.email + (r.ok ? '' : ' : ' + r.error))),
    accounts.length ? h('div', {}, h('b', {}, 'الحسابات الحالية:'),
      ...[...new Set(accounts.map((s) => (s.departments[0] || '') + '\u0001' + (s.sector || '')))].sort().map((key) => {
        const [d, sc] = key.split('\u0001');
        return sectorGroup(d, sc, accounts.filter((s) => (s.departments[0] || '') === d && (s.sector || '') === sc)
          .map((s) => accountRow(s, '🚧 ' + s.crew + (s.email ? ' • ' + s.email : '') + (s.areas && s.areas.length ? ' • المناطق: ' + s.areas.join('، ') : ''))));
      })) : '');
}

// ---------------- لوحة أداء الكوادر ----------------
let perf = { period: 'month', from: '', to: '', dept: 'all', sort: 'done', dir: -1 };
const PERIODS = { today: 'اليوم', d7: 'آخر 7 أيام', month: 'هذا الشهر', lastmonth: 'الشهر الماضي', all: 'كل الفترات' };

function perfRange() {
  if (perf.from || perf.to) return [dateMs(perf.from) || 0, dateMs(perf.to, true) || Infinity];
  const now = new Date();
  const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const m1 = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (perf.period === 'today') return [sod, Infinity];
  if (perf.period === 'd7') return [sod - 6 * DAY, Infinity];
  if (perf.period === 'month') return [m1, Infinity];
  if (perf.period === 'lastmonth') return [new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(), m1 - 1];
  return [0, Infinity];
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

// الأعمال المحسوبة = المُسندة للكادر خلال الفترة (حسب وقت الاستلام)
function perfRows() {
  const [from, to] = perfRange();
  const rows = [];
  allDepts().filter((d) => perf.dept === 'all' || d === perf.dept).forEach((dept) => {
    const names = new Set([
      ...deptCrews.filter((x) => x.dept === dept).flatMap((x) => x.crews),
      ...staff.filter((s) => s.departments.includes(dept)).flatMap((s) => s.crews || []),
      ...list.filter((c) => c.department === dept && c.crew).map((c) => c.crew),
    ]);
    names.forEach((crew) => {
      const cs = list.filter((c) => c.department === dept && c.crew === crew && c.status !== 'new')
        .filter((c) => { const t = workStart(c); return t >= from && t <= to; });
      const done = cs.filter((c) => c.status === 'resolved');
      const rated = done.filter((c) => c.rating > 0);
      rows.push({
        dept, crew, cs, label: crewLabel({ crew, department: dept }),
        assigned: cs.length, done: done.length, open: cs.length - done.length,
        rate: cs.length ? Math.round((done.length / cs.length) * 100) : null,
        dur: mean(done.filter((c) => c.resolvedMs).map((c) => c.resolvedMs - workStart(c))),
        resp: mean(cs.filter((c) => c.arrivedMs && c.crewMs && c.arrivedMs >= c.crewMs).map((c) => c.arrivedMs - c.crewMs)),
        rating: mean(rated.map((c) => c.rating)), ratedN: rated.length,
        reopened: cs.reduce((a, c) => a + (c.reopenCount || 0), 0),
      });
    });
  });
  return rows;
}

// ---------------- أداء الكوادر: لوحة شرف وبطاقات مجسّمة بهيكل قسم ← كادر ----------------
const pui = { open: {}, sel: null };
const SVGNS = 'http://www.w3.org/2000/svg';
const stars = (v) => '★'.repeat(Math.round(v)) + '☆'.repeat(5 - Math.round(v));

function ring(pct, cls) {
  const R = 32, C = 2 * Math.PI * R;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 80 80');
  svg.setAttribute('class', 'ring-svg');
  const mk = (c, dash) => {
    const e = document.createElementNS(SVGNS, 'circle');
    e.setAttribute('cx', '40'); e.setAttribute('cy', '40'); e.setAttribute('r', String(R));
    e.setAttribute('class', c); e.setAttribute('fill', 'none'); e.setAttribute('stroke-width', '8');
    if (dash !== undefined) { e.setAttribute('stroke-dasharray', dash + ' ' + C); e.setAttribute('stroke-linecap', 'round'); e.setAttribute('transform', 'rotate(-90 40 40)'); }
    return e;
  };
  svg.append(mk('ring-bg'), mk('ring-fg ' + cls, (C * Math.min(100, pct)) / 100));
  return h('div', { class: 'ring' }, svg, h('span', {}, pct + '%'));
}

function podium(rows) {
  const top = rows.filter((r) => r.done > 0).sort((a, b) => b.done - a.done || (a.dur ?? 1e18) - (b.dur ?? 1e18)).slice(0, 3);
  if (!top.length) return '';
  const spot = (r, k) => h('div', { class: 'pod p' + k },
    h('div', { class: 'pod-who' }, h('span', { class: 'pod-medal' }, ['🥇', '🥈', '🥉'][k - 1]), h('b', {}, r.label), h('small', {}, r.dept)),
    h('div', { class: 'pod-base' }, h('b', {}, String(r.done)), h('small', {}, 'منجز')));
  const order = [top[1] && [top[1], 2], top[0] && [top[0], 1], top[2] && [top[2], 3]].filter(Boolean);
  return h('div', { class: 'card' }, h('h3', {}, '🏆 لوحة الشرف'), h('div', { class: 'podium' }, ...order.map(([r, k]) => spot(r, k))));
}

function perfCard(r, rank, now) {
  const key = r.dept + '|' + r.crew;
  const a = aggJobs(r.cs, now);
  const selOn = pui.sel === key;
  const tone = r.rate === null ? 'none' : r.rate >= 80 ? 'good' : r.rate >= 50 ? 'mid' : 'low';
  const tile = (v, l, c) => h('div', { class: 'tile' + (c ? ' ' + c : '') }, h('b', {}, v), h('small', {}, l));
  const node = { key: 'p:' + key, level: 'crew', dept: r.dept, crew: r.crew, title: r.label, cs: r.cs, agg: a, children: [] };
  return h('div', { class: 'org-node lv-crew pf-node' },
    h('div', { class: 'pf-card tone-' + tone + (a.late.length ? ' has-late' : '') },
      h('div', { class: 'pf-rank' }, r.assigned ? ((r.done && ['🥇', '🥈', '🥉'][rank - 1]) || '#' + rank) : '—'),
      ring(r.rate === null ? 0 : r.rate, tone),
      h('div', { class: 'org-main' }, h('b', {}, '🚧 ' + r.label),
        h('div', { class: 'org-chips' },
          a.late.length ? h('span', { class: 'chip bad' }, '🔴 متأخر ' + a.late.length) : h('span', { class: 'chip ok' }, '🟢 بلا تأخير'),
          r.reopened ? h('span', { class: 'chip warn' }, '🔁 أُعيد فتحها ' + r.reopened) : '',
          r.rating !== null ? h('span', { class: 'chip stars' }, stars(r.rating) + ' ' + r.rating.toFixed(1)) : '')),
      h('div', { class: 'tiles' },
        tile(String(r.done), 'منجزة', 'ok'), tile(String(r.assigned), 'مُسندة'), tile(String(r.open), 'قيد العمل', r.open ? 'warn' : ''),
        tile(r.dur === null ? '-' : fmtD(r.dur), 'متوسط الإنجاز'), tile(r.resp === null ? '-' : fmtD(r.resp), 'متوسط الاستجابة')),
      h('button', { class: 'act org-btn' + (selOn ? ' on' : ''), onclick: () => { pui.sel = selOn ? null : key; render(); } }, selOn ? 'إخفاء التفاصيل' : 'التفاصيل')),
    selOn ? orgDetail(node, now) : '');
}

function renderPerf() {
  const now = Date.now();
  const bar = h('div', { class: 'card bar' },
    field('الفترة', sel(Object.entries(PERIODS), perf.from || perf.to ? '' : perf.period, (v) => { perf.period = v; perf.from = ''; perf.to = ''; render(); })),
    field('من', h('input', { type: 'date', value: perf.from, onchange: (e) => { perf.from = e.target.value; render(); } })),
    field('إلى', h('input', { type: 'date', value: perf.to, onchange: (e) => { perf.to = e.target.value; render(); } })),
    field('القسم', sel([['all', 'كل الأقسام'], ...allDepts().map((d) => [d, d])], perf.dept, (v) => { perf.dept = v; render(); })));
  const rows = perfRows();
  if (!rows.length) return [bar, h('div', { class: 'empty' }, 'لا توجد كوادر معرّفة بعد')];

  const key = perf.sort;
  rows.sort((a, b) => {
    const x = a[key], y = b[key];
    if (x === null || x === undefined) return (y === null || y === undefined) ? 0 : 1;
    if (y === null || y === undefined) return -1;
    return (x - y) * perf.dir || (b.done - a.done);
  });
  rows.forEach((r, i) => { r.rank = i + 1; });

  const pick = (arr, f, best) => arr.filter((r) => r[f] !== null && r[f] !== undefined && (f !== 'done' || r.done > 0))
    .sort((a, b) => (best === 'max' ? b[f] - a[f] : a[f] - b[f]))[0];
  const top = pick(rows, 'done', 'max'), fast = pick(rows, 'dur', 'min'), resp = pick(rows, 'resp', 'min');
  const rated = rows.filter((r) => r.rating !== null).sort((a, b) => b.rating - a.rating || b.ratedN - a.ratedN)[0];
  const hl = h('div', { class: 'sum' },
    top ? h('span', { class: 'chip ok' }, '🏆 الأكثر إنجازاً: ' + top.label + ' (' + top.done + ')') : '',
    fast ? h('span', { class: 'chip ok' }, '⚡ الأسرع إنجازاً: ' + fast.label + ' (' + fmtD(fast.dur) + ')') : '',
    resp ? h('span', { class: 'chip ok' }, '🏃 الأسرع استجابة: ' + resp.label + ' (' + fmtD(resp.resp) + ')') : '',
    rated ? h('span', { class: 'chip ok' }, '⭐ الأعلى تقييماً: ' + rated.label + ' (' + rated.rating.toFixed(1) + ')') : '');
  const tot = rows.reduce((a, r) => ({ a: a.a + r.assigned, d: a.d + r.done }), { a: 0, d: 0 });
  const lateAll = rows.reduce((a, r) => a + aggJobs(r.cs, now).late.length, 0);
  const kpi = (v, l, c) => h('div', { class: 'tile big' + (c ? ' ' + c : '') }, h('b', {}, String(v)), h('small', {}, l));
  const kp = h('div', { class: 'card' }, h('div', { class: 'tiles' },
    kpi(rows.length, '🚧 الكوادر'), kpi(tot.a, '📋 المُسندة'), kpi(tot.d, '✅ المنجزة', 'ok'), kpi(tot.a - tot.d, '🔧 قيد العمل', 'warn'),
    kpi(tot.a ? Math.round((tot.d / tot.a) * 100) + '%' : '-', '📈 نسبة الإنجاز'), kpi(lateAll, '🔴 متأخرة الآن', lateAll ? 'bad' : '')));

  const COLS = [['done', 'منجزة'], ['assigned', 'مُسندة'], ['open', 'قيد العمل'], ['rate', 'نسبة الإنجاز'], ['dur', 'متوسط الإنجاز'], ['resp', 'الاستجابة'], ['rating', 'التقييم'], ['reopened', 'أُعيد فتحها']];
  const sorter = h('div', { class: 'card' }, h('b', {}, 'ترتيب الكوادر حسب: '),
    h('div', { class: 'pills' }, ...COLS.map(([k, l]) => h('button', { class: 'pill' + (perf.sort === k ? ' on' : ''), onclick: () => {
      if (perf.sort === k) perf.dir = -perf.dir; else { perf.sort = k; perf.dir = (k === 'dur' || k === 'resp') ? 1 : -1; } render();
    } }, l + (perf.sort === k ? (perf.dir === -1 ? ' ▼' : ' ▲') : '')))),
    h('p', { class: 'small' }, 'الأعمال المحسوبة هي المُسندة للكادر خلال الفترة. زمن الاستجابة = من الإسناد حتى وصول الكادر للموقع. الحلقة = نسبة الإنجاز.'));

  const depts = [...new Set(rows.map((r) => r.dept))];
  const tree = depts.map((dept) => {
    const rs = rows.filter((r) => r.dept === dept);
    const dd = rs.reduce((a, r) => ({ a: a.a + r.assigned, d: a.d + r.done }), { a: 0, d: 0 });
    const pct = dd.a ? Math.round((dd.d / dd.a) * 100) : 0;
    const isOpen = pui.open[dept] === undefined ? true : pui.open[dept];
    const prog = h('div', { class: 'org-prog' }, h('i'));
    prog.firstChild.style.width = pct + '%';
    return h('div', { class: 'org-node lv-dept' },
      h('div', { class: 'org-head' },
        h('button', { class: 'org-tg', onclick: () => { pui.open[dept] = !isOpen; render(); } }, isOpen ? '▾' : '◂'),
        h('div', { class: 'org-main' }, h('b', {}, '🏢 ' + dept), h('small', {}, rs.length + ' كادر')),
        h('div', { class: 'org-chips' }, h('span', { class: 'chip' }, '📋 ' + dd.a), h('span', { class: 'chip ok' }, '✅ ' + dd.d), h('span', { class: 'chip warn' }, '🔧 ' + (dd.a - dd.d))),
        prog, h('span', { class: 'small' }, pct + '%')),
      isOpen ? h('div', { class: 'org-kids' }, ...rs.map((r) => perfCard(r, r.rank, now))) : '');
  });
  return [bar, kp, podium(rows), hl, sorter, h('div', { class: 'org-tree' }, ...tree)];
}

function renderBusy() {
  const stats = crewStats();
  if (!stats.length) return [h('div', { class: 'empty' }, 'لا توجد كوادر معرّفة بعد: أضفها من صفحة «توزيع الكوادر والقواطع»')];
  const now = Date.now();
  const out = [];
  let totalBusy = 0, totalFree = 0;
  const blocks = stats.map((d) => {
    const busy = [], free = [];
    d.rows.forEach((r) => {
      const jobs = list.filter((c) => c.department === d.dept && c.crew === r.crew && c.status !== 'resolved' && c.status !== 'new');
      (jobs.length ? busy : free).push({ crew: r.crew, jobs });
    });
    busy.sort((a, b) => b.jobs.length - a.jobs.length);
    totalBusy += busy.length; totalFree += free.length;
    return { dept: d.dept, busy, free };
  });
  out.push(h('div', { class: 'card' },
    h('h3', {}, 'حالة الكوادر الآن'),
    h('div', { class: 'sum' },
      h('span', { class: 'chip warn' }, '🔴 مشغولة: ' + totalBusy),
      h('span', { class: 'chip ok' }, '🟢 متاحة: ' + totalFree))));
  blocks.forEach((b) => {
    out.push(h('div', { class: 'card' },
      h('h3', {}, b.dept),
      b.free.length ? h('div', { class: 'sum' }, h('b', {}, 'متاحة: '), ...b.free.map((f) => h('span', { class: 'chip ok' }, '🟢 ' + f.crew))) : '',
      !b.busy.length ? h('p', { class: 'small' }, 'لا توجد كوادر مشغولة في هذا القسم') : ''));
    b.busy.forEach((k) => {
      out.push(h('div', { class: 'card' },
        h('h3', {}, '🚧 ' + k.crew + ' — مشغول (' + k.jobs.length + ' ' + (k.jobs.length === 1 ? 'عمل' : 'أعمال') + ') • ' + b.dept),
        ...k.jobs.map((c) => {
          const since = c.crewMs || c.startedMs || c.routedMs || c.createdMs;
          return h('div', { class: c.priority === 'urgent' ? 'rep no' : 'rep yes' },
            h('b', {}, (c.priority === 'urgent' ? '🚨 ' : '') + c.title),
            h('div', { class: 'small' }, 'الأولوية: ' + (PRI[c.priority] || '-') + (c.branch ? ' • الفرع: ' + c.branch : '')),
            since ? h('div', { class: 'small' }, 'استلمها: ' + fmtT(since) + ' • مضى: ' + fmtD(now - since)) : '',
            c.lat !== null ? h('button', { class: 'act', onclick: () => window.api.openMap(c.lat, c.lng) }, '📍 الموقع على الخريطة') : '');
        })));
    });
  });
  return out;
}

// ---------------- تقارير الفروع: هيكل شجري مجسّم (قسم ← فرع ← كادر) ----------------
// مهلة الإنجاز بالساعات حسب الأولوية: ما زاد عنها يُعدّ تأخراً (تُحسب من استلام الكادر)
const LATE_H = { urgent: 12, high: 24, medium: 48, low: 72 };
const lateLimit = (c) => (LATE_H[c.priority] || 48) * 3600000;
const rpt = { open: {}, tabs: {}, sel: null, lateOnly: false };
const crewTitle = (c) => (c.crew ? crewLabel(c) : 'غير مُسند لكادر');

function jobInfo(c, now) {
  if (c.status === 'resolved') {
    const dur = c.resolvedMs && workStart(c) ? c.resolvedMs - workStart(c) : null;
    const over = dur === null ? 0 : dur - lateLimit(c);
    return { st: over > 0 ? 'doneLate' : 'done', dur, over, late: false };
  }
  const since = c.crew ? workStart(c) : (c.routedMs || c.createdMs);
  const age = since ? now - since : 0;
  const over = age - lateLimit(c);
  let st = 'working';
  if (c.blockedReason) st = 'blocked';
  else if (c.status === 'pending_review') st = 'review';
  else if (!c.crew) st = 'unassigned';
  return { st, since, age, over, late: since > 0 && over > 0 };
}

function aggJobs(cs, now) {
  const infos = cs.map((c) => ({ c, i: jobInfo(c, now) }));
  const isDone = (x) => x.i.st === 'done' || x.i.st === 'doneLate';
  const done = infos.filter(isDone), open = infos.filter((x) => !isDone(x));
  const rated = done.filter((x) => x.c.rating > 0);
  return {
    infos, done, open,
    late: open.filter((x) => x.i.late),
    doneLate: done.filter((x) => x.i.st === 'doneLate'),
    unassigned: open.filter((x) => x.i.st === 'unassigned'),
    blocked: open.filter((x) => x.i.st === 'blocked'),
    review: open.filter((x) => x.i.st === 'review'),
    avgDur: mean(done.filter((x) => x.i.dur !== null && x.i.dur >= 0).map((x) => x.i.dur)),
    rating: mean(rated.map((x) => x.c.rating)), ratedN: rated.length,
    reopened: cs.reduce((a, c) => a + (c.reopenCount || 0), 0),
    pct: cs.length ? Math.round((done.length / cs.length) * 100) : 0,
  };
}

function buildOrg(now) {
  const nodes = allDepts().map((dept) => {
    const inDept = list.filter((c) => c.department === dept && c.status !== 'new');
    const bset = new Set();
    staff.filter((s) => s.departments.includes(dept)).forEach((s) => (s.branches || []).forEach((b) => bset.add(b)));
    inDept.forEach((c) => { if (c.branch) bset.add(c.branch); });
    const crewKids = (cs, base) => [...new Set(cs.map((c) => c.crew || ''))].map((k) => ({
      key: 'c:' + base + '|' + k, level: 'crew', icon: k ? '🚧' : '⏳',
      title: k ? crewLabel({ crew: k, department: dept }) : 'غير مُسند لكادر',
      cs: cs.filter((c) => (c.crew || '') === k), dept, crew: k, children: [],
    }));
    const branches = [...bset].map((b) => {
      const cs = inDept.filter((c) => c.branch === b);
      return { key: 'b:' + dept + '|' + b, level: 'branch', icon: '🏬', title: b, cs, dept, children: crewKids(cs, dept + '|' + b) };
    });
    const nb = inDept.filter((c) => !c.branch);
    if (nb.length) branches.push({ key: 'b:' + dept + '|~', level: 'branch', icon: '📍', title: 'بدون فرع محدد', cs: nb, dept, children: crewKids(nb, dept + '|~') });
    return { key: 'd:' + dept, level: 'dept', icon: '🏢', title: dept, cs: inDept, dept, children: branches };
  }).filter((d) => d.cs.length || d.children.length);
  const fill = (n) => {
    n.agg = aggJobs(n.cs, now);
    n.children.forEach(fill);
    n.children.sort((x, y) => (y.agg.late.length - x.agg.late.length) || (y.cs.length - x.cs.length));
    const crews = new Set(n.cs.filter((c) => c.crew).map((c) => c.crew)).size;
    if (n.level === 'dept') n.sub = n.children.length + ' فرع • ' + crews + ' كادر';
    else if (n.level === 'branch') n.sub = crews + ' كادر عمل هنا';
    else n.sub = [n.agg.avgDur !== null ? 'متوسط الإنجاز ' + fmtD(n.agg.avgDur) : '', n.agg.rating !== null ? '⭐ ' + n.agg.rating.toFixed(1) : ''].filter(Boolean).join(' • ');
  };
  nodes.forEach(fill);
  return nodes;
}

const orgWalk = (n, f) => { f(n); n.children.forEach((k) => orgWalk(k, f)); };
const groupByCrew = (items) => {
  const m = new Map();
  items.forEach((x) => { const k = crewTitle(x.c); if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
  return [...m.entries()];
};

function jobRow({ c, i }) {
  const isDone = i.st === 'done' || i.st === 'doneLate';
  const cls = i.st === 'done' ? 'yes' : (i.st === 'doneLate' ? 'warn' : ((i.late || i.st === 'blocked') ? 'no' : 'info'));
  const when = isDone
    ? 'أُنجز: ' + fmtT(c.resolvedMs) + (i.dur !== null && i.dur >= 0 ? ' • المدة ' + fmtD(i.dur) : '') + (i.st === 'doneLate' ? ' • ⚠️ تجاوز المهلة بـ ' + fmtD(i.over) : ' • ✅ ضمن المهلة')
    : (STATUS[c.status] || c.status) + (i.since ? ' • منذ ' + fmtT(i.since) + ' • مضى ' + fmtD(i.age) : '') + (i.late ? ' • 🔴 متأخر بـ ' + fmtD(i.over) : ' • ضمن المهلة (المتبقي ' + fmtD(-i.over) + ')');
  const mat = !isDone && c.materials && ['requested', 'preparing', 'partial'].includes(c.materialsStatus) ? MAT_AR[c.materialsStatus] : '';
  return h('div', { class: 'rep ' + cls },
    h('b', {}, (c.priority === 'urgent' ? '🚨 ' : '') + c.title),
    h('div', { class: 'small' }, [crewTitle(c), c.branch ? 'الفرع: ' + c.branch : '', 'الأولوية: ' + (PRI[c.priority] || '-')].filter(Boolean).join(' • ')),
    h('div', { class: 'small' }, when),
    c.blockedReason ? h('div', { class: 'small' }, '🚫 تعذّر العمل: ' + c.blockedReason + (c.blockedBy ? ' (' + c.blockedBy + ')' : '')) : '',
    mat ? h('div', { class: 'small' }, mat) : '',
    c.returnNote && !isDone ? h('div', { class: 'small' }, '↩️ أُرجع للكادر: ' + c.returnNote) : '',
    c.reopenCount ? h('div', { class: 'small' }, '🔁 أعاد المواطن فتحها ' + c.reopenCount + ' مرة' + (c.reopenReason ? ': ' + c.reopenReason : '')) : '',
    isDone && c.rating > 0 ? h('div', { class: 'small' }, '⭐ تقييم المواطن: ' + c.rating) : '',
    c.lat !== null && c.lat !== undefined ? h('button', { class: 'act org-btn', onclick: () => window.api.openMap(c.lat, c.lng) }, '📍 الموقع على الخريطة') : '');
}

// أفكار تلقائية للمدير مبنية على أرقام العقدة المفتوحة
function ideasFor(n, now) {
  const a = n.agg, out = [];
  const add = (lvl, t) => out.push({ lvl, t });
  if (!a.infos.length) { add('info', 'لا توجد أعمال مسجّلة هنا بعد، فلا معطيات كافية لاقتراحات.'); return out; }
  const dept = n.dept;
  const loads = {};
  list.filter((c) => c.department === dept && c.crew && c.status !== 'resolved' && c.status !== 'new').forEach((c) => { loads[c.crew] = (loads[c.crew] || 0) + 1; });
  const all = new Set([...deptCrewNames(dept), ...staff.filter((s) => s.role === 'crew' && s.departments.includes(dept)).map((s) => s.crew), ...Object.keys(loads)].filter(Boolean));
  const free = [...all].filter((k) => !loads[k]);
  const lbl = (k) => crewLabel({ crew: k, department: dept });

  if (a.late.length) {
    const g = groupByCrew(a.late).sort((x, y) => y[1].length - x[1].length)[0];
    add('bad', '⏰ ' + a.late.length + ' عمل متأخر عن المهلة' + (n.level !== 'crew' && g ? ' — أكثرها عند «' + g[0] + '» (' + g[1].length + ')' : '') + '.');
    add('warn', free.length ? '💡 أعد إسناد المتأخر إلى كوادر متاحة الآن: ' + free.slice(0, 4).map(lbl).join('، ') + '.' : '💡 لا كوادر متاحة حالياً: فكّر بإضافة كادر مؤقت أو تأجيل الأعمال منخفضة الأولوية.');
  }
  if (a.unassigned.length) add('bad', '📌 ' + a.unassigned.length + ' شكوى موجّهة للقسم ولم تُسند لأي كادر بعد — أسندها أو فعّل الإسناد التلقائي.');
  if (a.blocked.length) add('bad', '🚫 ' + a.blocked.length + ' عمل تعذّر تنفيذه بانتظار قرارك — راجع الأسباب في تبويب «المتأخرون» وقرّر: مواد/ميزانية/تحويل لجهة أخرى.');
  const rv = a.review.filter((x) => x.i.age > 24 * 3600000).length;
  if (rv) add('warn', '🔎 ' + rv + ' عمل ينتظر اعتماد الإدارة منذ أكثر من يوم — اعتمده أو أرجعه للكادر ليُغلق الملف.');
  const matN = a.open.filter((x) => x.c.materials && ['requested', 'preparing', 'partial'].includes(x.c.materialsStatus)).length;
  if (matN) add('warn', '📦 ' + matN + ' عمل ينتظر تجهيز المواد — تأخير المخزن هو السبب المحتمل للتأخر، أسرع التجهيز.');
  if (n.level !== 'crew') {
    const ls = Object.values(loads);
    if (ls.length > 1 && Math.max(...ls) - Math.min(...ls) >= 3) add('warn', '⚖️ توزيع الحمل غير متوازن بين الكوادر (من ' + Math.min(...ls) + ' إلى ' + Math.max(...ls) + ' أعمال مفتوحة) — وازن الإسناد.');
    const cat = {};
    n.cs.forEach((c) => { const k = c.category || 'غير مصنّفة'; cat[k] = (cat[k] || 0) + 1; });
    const top = Object.entries(cat).sort((x, y) => y[1] - x[1])[0];
    if (top && top[1] >= 3) add('info', '🔁 تكرار شكاوى «' + top[0] + '» (' + top[1] + ' شكوى) — فكّر بحل جذري أو صيانة وقائية بدل المعالجة المتكررة.');
  }
  if (a.done.length >= 3 && a.doneLate.length / a.done.length >= 0.4) add('warn', '🐢 ' + a.doneLate.length + ' من ' + a.done.length + ' أعمال أُنجزت بعد المهلة — قد تكون المهلة أو الأعداد غير كافية.');
  if (a.reopened > 0 && a.done.length && a.reopened / a.done.length >= 0.2) add('bad', '🔁 ارتفاع إعادة فتح الشكاوى (' + a.reopened + ') — راجع جودة الإنجاز واطلب صورة «بعد» قبل الإغلاق.');
  if (a.rating !== null && a.ratedN >= 2 && a.rating < 3) add('bad', '⭐ تقييم المواطنين منخفض (' + a.rating.toFixed(1) + ' من 5) — اجتمع مع المسؤول وراجع الملاحظات.');
  if (a.done.length >= 3 && !a.late.length && !a.doneLate.length && !a.reopened && (a.rating === null || a.rating >= 4)) add('ok', '🏆 أداء ممتاز: ' + a.done.length + ' أعمال منجزة بلا تأخير ولا إعادة فتح — يستحق التقدير.');
  if (!out.length) add('ok', '✅ الوضع مستقر: لا تأخير ولا ملاحظات تستدعي تدخلك الآن.');
  return out;
}

function orgDetail(n, now) {
  const a = n.agg;
  const TABS = [['done', '✅ من أنجز (' + a.done.length + ')'], ['late', '⏰ المتأخرون (' + a.late.length + ')'], ['ideas', '💡 أفكار'], ['all', '📋 كل الأعمال (' + a.infos.length + ')']];
  const cur = rpt.tabs[n.key] || (a.late.length ? 'late' : 'done');
  const nav = h('div', { class: 'pills' }, ...TABS.map(([k, l]) => h('button', { class: 'pill' + (cur === k ? ' on' : ''), onclick: () => { rpt.tabs[n.key] = k; render(); } }, l)));
  let body;
  if (cur === 'done') {
    const xs = a.done.slice().sort((x, y) => y.c.resolvedMs - x.c.resolvedMs);
    body = !xs.length ? h('p', { class: 'small' }, 'لم يُنجز أي عمل بعد.') : h('div', {}, ...groupByCrew(xs).map(([k, g]) => {
      const dd = g.filter((x) => x.i.dur !== null && x.i.dur >= 0).map((x) => x.i.dur);
      const dl = g.filter((x) => x.i.st === 'doneLate').length;
      return h('div', { class: 'org-grp' },
        h('div', { class: 'sum' }, h('b', {}, '🚧 ' + k), h('span', { class: 'chip ok' }, '✅ ' + g.length + ' منجز'),
          dd.length ? h('span', { class: 'chip' }, 'متوسط الزمن: ' + fmtD(mean(dd))) : '',
          dl ? h('span', { class: 'chip warn' }, '⚠️ ' + dl + ' بعد المهلة') : ''),
        ...g.map(jobRow));
    }));
  } else if (cur === 'late') {
    const xs = a.late.slice().sort((x, y) => y.i.over - x.i.over);
    body = !xs.length ? h('p', { class: 'small' }, '🎉 لا توجد أعمال متأخرة.') : h('div', {}, ...groupByCrew(xs).map(([k, g]) => h('div', { class: 'org-grp' },
      h('div', { class: 'sum' }, h('b', {}, '🚧 ' + k), h('span', { class: 'chip bad' }, '🔴 ' + g.length + ' متأخر'), h('span', { class: 'chip' }, 'أقصى تأخير: ' + fmtD(Math.max(...g.map((x) => x.i.over))))),
      ...g.map(jobRow))));
  } else if (cur === 'ideas') {
    body = h('div', {}, ...ideasFor(n, now).map((x) => h('div', { class: 'idea ' + x.lvl }, x.t)),
      h('p', { class: 'small' }, 'اقتراحات آلية مبنية على أرقام هذه العقدة فقط، والقرار النهائي للمدير.'));
  } else {
    body = !a.infos.length ? h('p', { class: 'small' }, 'لا توجد أعمال.') : h('table', {},
      h('tr', {}, ...['العمل', 'الكادر', 'الحالة', 'الأولوية', 'المهلة'].map((x) => h('th', {}, x))),
      ...a.infos.slice().sort((x, y) => (y.i.late - x.i.late) || ((y.c.createdMs || 0) - (x.c.createdMs || 0))).map(({ c, i }) => h('tr', {},
        h('td', {}, c.title), h('td', {}, crewTitle(c)), h('td', {}, STATUS[c.status] || c.status), h('td', {}, PRI[c.priority] || '-'),
        h('td', { class: i.late || i.st === 'doneLate' ? 'warn' : '' }, i.st === 'done' ? '✅ ضمن المهلة' : i.st === 'doneLate' ? '⚠️ أُنجز متأخراً' : i.late ? '🔴 متأخر ' + fmtD(i.over) : '🟢 ضمن المهلة'))));
  }
  return h('div', { class: 'org-det' }, nav, body);
}

function orgNode(n, now) {
  const a = n.agg;
  const isOpen = rpt.open[n.key] === undefined ? n.level === 'dept' : rpt.open[n.key];
  const selOn = rpt.sel === n.key;
  const prog = h('div', { class: 'org-prog', title: 'نسبة الإنجاز ' + a.pct + '%' }, h('i'));
  prog.firstChild.style.width = a.pct + '%';
  const head = h('div', { class: 'org-head' + (a.late.length ? ' has-late' : '') },
    n.children.length
      ? h('button', { class: 'org-tg', title: isOpen ? 'طي' : 'فتح', onclick: () => { rpt.open[n.key] = !isOpen; render(); } }, isOpen ? '▾' : '◂')
      : h('span', { class: 'org-tg off' }, '•'),
    h('div', { class: 'org-main' }, h('b', {}, n.icon + ' ' + n.title), n.sub ? h('small', {}, n.sub) : ''),
    h('div', { class: 'org-chips' },
      h('span', { class: 'chip' }, '📋 ' + a.infos.length),
      h('span', { class: 'chip ok' }, '✅ ' + a.done.length),
      h('span', { class: 'chip' + (a.open.length ? ' warn' : '') }, '🔧 ' + a.open.length),
      a.late.length ? h('span', { class: 'chip bad' }, '🔴 متأخر ' + a.late.length) : ''),
    prog, h('span', { class: 'small' }, a.pct + '%'),
    h('button', { class: 'act org-btn' + (selOn ? ' on' : ''), onclick: () => { rpt.sel = selOn ? null : n.key; render(); } }, selOn ? 'إخفاء التفاصيل' : 'التفاصيل'));
  return h('div', { class: 'org-node lv-' + n.level }, head,
    selOn ? orgDetail(n, now) : '',
    isOpen && n.children.length ? h('div', { class: 'org-kids' }, ...n.children.map((k) => orgNode(k, now))) : '');
}

// ---------------- مؤشرات هندسية مجسّمة لتقارير الفروع (SVG مجسّم: أعمدة إيزومترية + سداسي + حلقة ثلاثية الأبعاد) ----------------
function sv(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  kids.flat().forEach((x) => { if (x !== null && x !== undefined && x !== '') e.append(x); });
  return e;
}
// ألوان كل مؤشر: [الوجه العلوي، الجانب المضيء، الجانب المظلل]
const KP = {
  blue: ['#bfdbfe', '#3b82f6', '#1e40af'],
  green: ['#bbf7d0', '#22c55e', '#166534'],
  orange: ['#fed7aa', '#f97316', '#9a3412'],
  red: ['#fecaca', '#ef4444', '#991b1b'],
  gray: ['#e2e8f0', '#94a3b8', '#475569'],
};
let kpUid = 0;
const kpState = { dept: null };
const pts = (a) => a.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');

// عمود إيزومتري: (x,y) = الزاوية الأمامية السفلى، hh = الارتفاع
function isoBar(x, y, hh, pal, tip) {
  const a = 17, b = 10, st = { stroke: 'rgba(255,255,255,.45)', 'stroke-width': 1, 'stroke-linejoin': 'round' };
  return sv('g', { class: 'kp-bar' }, sv('title', {}, tip),
    sv('polygon', { points: pts([[x, y], [x - a, y - b], [x - a, y - b - hh], [x, y - hh]]), fill: pal[1], ...st }),
    sv('polygon', { points: pts([[x, y], [x + a, y - b], [x + a, y - b - hh], [x, y - hh]]), fill: pal[2], ...st }),
    sv('polygon', { points: pts([[x, y - hh], [x - a, y - b - hh], [x, y - 2 * b - hh], [x + a, y - b - hh]]), fill: pal[0], ...st }));
}

// مجموعة أعمدة الفرع على منصّة إيزومترية: (الإجمالي، منجز، قيد العمل، متأخر) من اليمين إلى اليسار
function kpBars(n, maxV) {
  const a = n.agg;
  const items = [
    ['الإجمالي', a.infos.length, KP.blue],
    ['منجز', a.done.length, KP.green],
    ['قيد العمل', a.open.length, KP.orange],
    ['متأخر', a.late.length, KP.red],
  ];
  const W = 230, y = 150, cy = y - 10, MAXH = 92;
  const svg = sv('svg', { viewBox: '0 0 ' + W + ' 206', class: 'kp-svg kp-iso', role: 'img', 'aria-label': 'أعمدة ' + n.title });
  // المنصّة: معيّن بسُمك
  const L = [20, cy], T = [W / 2, cy - 36], R = [W - 20, cy], B = [W / 2, cy + 36], th = 9;
  svg.append(
    sv('polygon', { points: pts([L, B, [B[0], B[1] + th], [L[0], L[1] + th]]), class: 'kp-slab-l' }),
    sv('polygon', { points: pts([R, B, [B[0], B[1] + th], [R[0], R[1] + th]]), class: 'kp-slab-r' }),
    sv('polygon', { points: pts([L, T, R, B]), class: 'kp-slab-t' }));
  items.forEach(([lbl, v, pal], i) => {
    const x = W - 56 - i * 43; // الأول عند اليمين
    const hh = v > 0 ? Math.max(8, (v / Math.max(maxV, 1)) * MAXH) : 3;
    svg.append(isoBar(x, y, hh, v > 0 ? pal : KP.gray, lbl + ': ' + v),
      sv('text', { x, y: y - hh - 2 * 10 - 6, class: 'kp-t', 'text-anchor': 'middle' }, String(v)),
      sv('text', { x, y: cy + 36 + th + 16, class: 'kp-m', 'text-anchor': 'middle' }, lbl));
  });
  return svg;
}

// مؤشر سداسي مُسطَّح بسُمك: يمتلئ من الأسفل بنسبة الإنجاز
function kpHex(pct, hasData, label) {
  const id = 'kph' + (++kpUid), cx = 60, cy = 56, R = 46, D = 11;
  const hex = (dy, r = R) => pts([0, 1, 2, 3, 4, 5].map((k) => { const t = (-90 + 60 * k) * Math.PI / 180; return [cx + r * Math.cos(t), cy + dy + r * Math.sin(t)]; }));
  const pal = !hasData ? KP.gray : pct >= 75 ? KP.green : pct >= 40 ? KP.blue : pct > 0 ? KP.orange : KP.red;
  const top = cy - R, hgt = 2 * R, fillH = hgt * (hasData ? pct : 0) / 100;
  const svg = sv('svg', { viewBox: '0 0 120 136', class: 'kp-svg kp-hex', role: 'img', 'aria-label': label + ' ' + pct + '%' });
  svg.append(sv('title', {}, label + ': ' + (hasData ? pct + '%' : 'لا بيانات')));
  for (let k = D; k >= 1; k -= 1) svg.append(sv('polygon', { points: hex(k), fill: pal[2] }));
  svg.append(
    sv('defs', {},
      sv('clipPath', { id }, sv('polygon', { points: hex(0, R - 5) })),
      sv('linearGradient', { id: id + 'g', x1: 0, y1: 0, x2: 0, y2: 1 },
        sv('stop', { offset: '0', 'stop-color': pal[0] }), sv('stop', { offset: '1', 'stop-color': pal[1] }))),
    sv('polygon', { points: hex(0), class: 'kp-hex-face', stroke: 'rgba(255,255,255,.7)', 'stroke-width': 1.5 }),
    sv('g', { 'clip-path': 'url(#' + id + ')' },
      sv('rect', { x: cx - R, y: top, width: 2 * R, height: hgt, class: 'kp-hex-well' }),
      sv('rect', { x: cx - R, y: top + hgt - fillH, width: 2 * R, height: fillH, fill: 'url(#' + id + 'g)' }),
      fillH > 0 && fillH < hgt ? sv('rect', { x: cx - R, y: top + hgt - fillH, width: 2 * R, height: 3, fill: 'rgba(255,255,255,.65)' }) : ''),
    sv('polygon', { points: hex(0, R - 5), fill: 'none', stroke: 'rgba(15,27,61,.18)', 'stroke-width': 1 }),
    sv('text', { x: cx, y: cy + 8, class: 'kp-big', 'text-anchor': 'middle' }, hasData ? pct + '%' : '—'),
    sv('text', { x: cx, y: cy + 24, class: 'kp-big kp-sm', 'text-anchor': 'middle' }, 'إنجاز'));
  return svg;
}

// حلقة إهليلجية ثلاثية الأبعاد للقسم: تتوزع الأعمال على أربع حالات
function kpRing(segs, total) {
  const cx = 130, cy = 72, rx = 104, ry = 50, k = 0.56, D = 16;
  const P = (r1, r2, t) => [cx + r1 * Math.cos(t), cy + r2 * Math.sin(t)];
  const path = (t0, t1, dy = 0) => {
    const o0 = P(rx, ry, t0), o1 = P(rx, ry, t1), i1 = P(rx * k, ry * k, t1), i0 = P(rx * k, ry * k, t0), big = (t1 - t0) > Math.PI ? 1 : 0;
    return 'M' + o0[0] + ',' + (o0[1] + dy) + ' A' + rx + ',' + ry + ' 0 ' + big + ' 1 ' + o1[0] + ',' + (o1[1] + dy) +
      ' L' + i1[0] + ',' + (i1[1] + dy) + ' A' + rx * k + ',' + ry * k + ' 0 ' + big + ' 0 ' + i0[0] + ',' + (i0[1] + dy) + ' Z';
  };
  const arcs = [];
  let t = -Math.PI / 2;
  segs.filter((s) => s.v > 0).forEach((s) => {
    const span = (s.v / total) * 2 * Math.PI;
    if (span > Math.PI * 1.999) { arcs.push({ s, t0: t, t1: t + Math.PI }, { s, t0: t + Math.PI, t1: t + 2 * Math.PI }); } else arcs.push({ s, t0: t, t1: t + span });
    t += span;
  });
  const svg = sv('svg', { viewBox: '0 0 260 ' + (cy + ry + D + 14), class: 'kp-svg kp-ring', role: 'img', 'aria-label': 'توزيع أعمال القسم' });
  if (!arcs.length) arcs.push({ s: { pal: KP.gray, name: 'لا أعمال', v: 0 }, t0: -Math.PI / 2, t1: Math.PI * 0.5 }, { s: { pal: KP.gray, name: 'لا أعمال', v: 0 }, t0: Math.PI * 0.5, t1: Math.PI * 1.5 });
  for (let d = D; d >= 1; d -= 2) arcs.forEach((x) => svg.append(sv('path', { d: path(x.t0, x.t1, d), fill: x.s.pal[2] })));
  arcs.forEach((x) => svg.append(sv('path', { d: path(x.t0, x.t1), fill: x.s.pal[1], stroke: 'rgba(255,255,255,.75)', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }, sv('title', {}, x.s.name + ': ' + x.s.v))));
  // لمعة على الحافة العلوية
  svg.append(sv('ellipse', { cx, cy, rx: rx - 2, ry: ry - 1, fill: 'none', stroke: 'rgba(255,255,255,.35)', 'stroke-width': 1.2 }),
    sv('text', { x: cx, y: cy + 4, class: 'kp-big', 'text-anchor': 'middle' }, String(total)),
    sv('text', { x: cx, y: cy + 19, class: 'kp-m', 'text-anchor': 'middle' }, 'إجمالي الأعمال'));
  return svg;
}

const kpDot = (color, text, val) => {
  const d = h('i', { class: 'kp-dot' });
  d.style.background = color;
  return h('div', { class: 'kp-leg' }, d, h('span', {}, text), h('b', {}, String(val)));
};

function kpTile(n, maxV) {
  const a = n.agg, has = a.infos.length > 0;
  const onTime = a.done.length ? Math.round(((a.done.length - a.doneLate.length) / a.done.length) * 100) : null;
  return h('div', { class: 'kp-tile' + (a.late.length ? ' has-late' : '') },
    h('div', { class: 'kp-tile-h' }, h('b', {}, n.icon + ' ' + n.title), h('small', {}, n.sub || '')),
    h('div', { class: 'kp-tile-b' }, kpHex(a.pct, has, n.title), kpBars(n, maxV)),
    h('div', { class: 'kp-foot' },
      onTime !== null ? h('span', { class: 'chip' + (onTime >= 70 ? ' ok' : ' warn') }, '⏱ ضمن المهلة ' + onTime + '%') : '',
      a.avgDur !== null ? h('span', { class: 'chip' }, 'متوسط الإنجاز ' + fmtD(a.avgDur)) : '',
      a.rating !== null ? h('span', { class: 'chip' }, '⭐ ' + a.rating.toFixed(1)) : '',
      a.unassigned.length ? h('span', { class: 'chip warn' }, '📌 غير مُسندة ' + a.unassigned.length) : ''));
}

function kpDashboard(tree) {
  const depts = tree.filter((d) => d.children.length);
  if (!depts.length) return '';
  if (!kpState.dept || !depts.some((d) => d.dept === kpState.dept)) kpState.dept = depts[0].dept;
  const d = depts.find((x) => x.dept === kpState.dept), a = d.agg;
  const maxV = Math.max(1, ...d.children.map((b) => b.agg.infos.length));
  const segs = [
    { name: 'منجز ضمن المهلة', v: a.done.length - a.doneLate.length, pal: KP.green },
    { name: 'منجز بعد المهلة', v: a.doneLate.length, pal: KP.blue },
    { name: 'قيد العمل ضمن المهلة', v: a.open.length - a.late.length, pal: KP.orange },
    { name: 'متأخر الآن', v: a.late.length, pal: KP.red },
  ];
  const pills = h('div', { class: 'pills' }, ...depts.map((x) => h('button', { class: 'pill' + (x.dept === kpState.dept ? ' on' : ''), onclick: () => { kpState.dept = x.dept; render(); } }, '🏢 ' + x.title)));
  const cols = [['الإجمالي', KP.blue], ['منجز', KP.green], ['قيد العمل', KP.orange], ['متأخر', KP.red]];
  const keyRow = h('div', { class: 'kp-key' }, ...cols.map(([t, p]) => { const e = kpDot(p[1], t, ''); e.lastChild.remove(); return e; }));
  return h('div', { class: 'card kp-card' },
    h('h3', {}, '📐 مؤشرات الفروع الهندسية'),
    h('p', { class: 'small' }, 'كل فرع يُعرض بمؤشر سداسي لنسبة الإنجاز وأعمدة مجسّمة للأعمال. الفروع الأكثر تأخراً تظهر أولاً، وأطوال الأعمدة متناسبة داخل القسم الواحد.'),
    pills,
    h('div', { class: 'kp-dept' },
      h('div', { class: 'kp-ring-box' }, kpRing(segs, a.infos.length),
        h('div', { class: 'kp-legs' }, ...segs.map((s) => kpDot(s.pal[1], s.name, s.v)))),
      h('div', { class: 'kp-dept-info' },
        h('h4', {}, d.icon + ' ' + d.title),
        h('div', { class: 'small' }, d.sub),
        h('div', { class: 'sum' },
          h('span', { class: 'chip ok' }, '✅ إنجاز القسم ' + a.pct + '%'),
          h('span', { class: 'chip' + (a.late.length ? ' bad' : '') }, '🔴 متأخر ' + a.late.length),
          a.avgDur !== null ? h('span', { class: 'chip' }, 'متوسط الإنجاز ' + fmtD(a.avgDur)) : '',
          a.rating !== null ? h('span', { class: 'chip' }, '⭐ ' + a.rating.toFixed(1)) : ''),
        keyRow)),
    h('div', { class: 'kp-grid' }, ...d.children.map((b) => kpTile(b, maxV))));
}

function renderReport() {
  const now = Date.now();
  let tree = buildOrg(now);
  if (!tree.length) return [h('div', { class: 'empty' }, 'لا توجد بيانات بعد')];
  const whole = aggJobs(tree.flatMap((d) => d.cs), now);
  if (rpt.lateOnly) {
    const prune = (n) => { n.children = n.children.filter((k) => k.agg.late.length); n.children.forEach(prune); };
    tree = tree.filter((d) => d.agg.late.length);
    tree.forEach(prune);
  }
  const tools = h('div', { class: 'card bar' },
    h('button', { class: 'act', onclick: () => { tree.forEach((d) => orgWalk(d, (n) => { rpt.open[n.key] = true; })); render(); } }, '📂 فتح الكل'),
    h('button', { class: 'act', onclick: () => { tree.forEach((d) => orgWalk(d, (n) => { rpt.open[n.key] = false; })); rpt.sel = null; render(); } }, '📁 طي الكل'),
    h('button', { class: 'act' + (rpt.lateOnly ? ' on' : ''), onclick: () => { rpt.lateOnly = !rpt.lateOnly; render(); } }, rpt.lateOnly ? '👁 عرض الكل' : '⏰ المتأخرون فقط'),
    h('span', { class: 'small' }, 'مهلة الإنجاز: عاجلة ' + LATE_H.urgent + ' ساعة • عالية ' + LATE_H.high + ' • متوسطة ' + LATE_H.medium + ' • منخفضة ' + LATE_H.low + ' (من استلام الكادر)'));
  const sum = h('div', { class: 'card' },
    h('h3', {}, '🧬 الهيكل العام: قسم ← فرع ← كادر'),
    h('div', { class: 'sum' },
      h('span', { class: 'chip' }, '📋 الأعمال: ' + whole.infos.length),
      h('span', { class: 'chip ok' }, '✅ منجزة: ' + whole.done.length + (whole.doneLate.length ? ' (منها ' + whole.doneLate.length + ' متأخرة)' : '')),
      h('span', { class: 'chip warn' }, '🔧 قيد العمل: ' + whole.open.length),
      h('span', { class: 'chip bad' }, '🔴 متأخرة الآن: ' + whole.late.length),
      h('span', { class: 'chip' }, '📌 غير مُسندة: ' + whole.unassigned.length)),
    h('p', { class: 'small' }, 'اضغط ◂ لفتح الفروع والكوادر، و«التفاصيل» لمعرفة من أنجز ومن تأخر والأفكار المقترحة.'));
  const kpi = kpDashboard(buildOrg(now));
  if (!tree.length) return [tools, sum, kpi, h('div', { class: 'empty' }, '🎉 لا توجد أعمال متأخرة')];
  return [tools, sum, kpi, h('div', { class: 'org-tree' }, ...tree.map((d) => orgNode(d, now)))];
}

let draft = { title: '', text: '', name: '', phone: '', department: '', priority: 'medium', imageB64: '' };

function renderManual() {
  const inp = (key, ph) => h('input', { type: 'text', value: draft[key], placeholder: ph, oninput: (e) => { draft[key] = e.target.value; } });
  const text = h('textarea', { value: draft.text, placeholder: 'تفاصيل الشكوى كما ذكرها المواطن', oninput: (e) => { draft.text = e.target.value; } });
  const dept = h('select', { onchange: (e) => { draft.department = e.target.value; } },
    h('option', { value: '' }, 'تحليل وتوجيه تلقائي'),
    ...(settings.departments || []).map((d) => h('option', { value: d }, d)));
  dept.value = draft.department;
  const pri = h('select', { onchange: (e) => { draft.priority = e.target.value; } },
    ...Object.entries(PRI).map(([k, v]) => h('option', { value: k }, v)));
  pri.value = draft.priority;
  const preview = h('img', { src: draft.imageB64 ? 'data:image/jpeg;base64,' + draft.imageB64 : '' });
  preview.hidden = !draft.imageB64;
  return [h('div', { class: 'card' },
    h('h3', {}, 'إدخال شكوى يدوياً'),
    h('label', {}, 'عنوان الشكوى'), inp('title', 'مثال: حفرة في الشارع'),
    h('label', {}, 'تفاصيل الشكوى'), text,
    h('label', {}, 'اسم المواطن (اختياري)'), inp('name', ''),
    h('label', {}, 'رقم الهاتف (اختياري)'), inp('phone', ''),
    h('label', {}, 'القسم'), dept,
    h('label', {}, 'الأولوية (تُستعمل عند اختيار قسم يدوياً)'), pri,
    h('label', {}, 'صورة (اختيارية)'),
    h('button', { class: 'act', onclick: async () => {
      const b = await window.api.pickImage();
      if (b) { draft.imageB64 = b; preview.src = 'data:image/jpeg;base64,' + b; preview.hidden = false; }
    } }, 'اختيار صورة'),
    h('button', { class: 'act', onclick: () => { draft.imageB64 = ''; preview.hidden = true; } }, 'إزالة الصورة'),
    preview,
    h('div', {}, h('button', { class: 'act', onclick: async () => {
      const r = await window.api.addComplaint(draft);
      if (r.ok) {
        draft = { title: '', text: '', name: '', phone: '', department: '', priority: 'medium', imageB64: '' };
        render();
      } else {
        document.getElementById('log').textContent = r.error;
      }
    } }, 'حفظ الشكوى')))];
}

// عنوان الصفحة وعدّادات الشريط الجانبي ومؤشرات الأداء السريعة
function updateChrome() {
  const b = document.querySelector('nav button.on');
  const t = document.getElementById('title');
  if (t && b) t.textContent = (b.querySelector('.lbl') || b).textContent;
  const cnt = (f) => list.filter(f).length;
  const setBadge = (id, n) => { const e = document.getElementById(id); if (e) { e.textContent = n; e.classList.toggle('hide', !n); } };
  setBadge('b-new', cnt((c) => c.status === 'new'));
  setBadge('b-scan', scans.filter((x) => x.state === 'ready').length);
  setBadge('b-routed', cnt((c) => c.status === 'routed' || c.status === 'in_progress' || c.status === 'pending_review'));
  const k = document.getElementById('kpis');
  if (!k) return;
  const sod = new Date(); sod.setHours(0, 0, 0, 0);
  const kpi = (cls, n, l) => h('span', { class: 'kpi ' + cls }, h('b', {}, String(n)), l);
  k.replaceChildren(
    kpi('amber', cnt((c) => c.status === 'new'), 'جديدة'),
    kpi('', cnt((c) => c.status === 'routed' || c.status === 'in_progress'), 'قيد المعالجة'),
    kpi('amber', cnt((c) => c.status === 'pending_review'), 'بانتظار الاعتماد'),
    kpi('red', cnt((c) => c.priority === 'urgent' && c.status !== 'resolved' && c.status !== 'new'), 'عاجلة مفتوحة'),
    kpi('green', cnt((c) => c.status === 'resolved' && c.resolvedMs >= sod.getTime()), 'منجزة اليوم'));
}



// ---------------- السكانر (مسح الشكاوى الورقية وقراءتها وتحديد نوعها) ----------------
let scans = [], scanBusy = false, scanFolderPath = '', scanMsg = '';
function scanOnItem(it) {
  if (it.state === 'ready') it.dept = it.known ? it.department : '';
  const i = scans.findIndex((x) => x.id === it.id);
  if (i < 0) scans.unshift(it); else scans[i] = { ...scans[i], ...it };
  updateChrome();
  if (tab === 'scan') render();
}
function scanCard(it) {
  const drop = () => { scans = scans.filter((x) => x !== it); updateChrome(); render(); };
  if (it.state === 'processing') return h('div', { class: 'card' }, h('h3', {}, '⏳ جارٍ قراءة الورقة…'), h('small', {}, it.fileName));
  if (it.state === 'error') return h('div', { class: 'card urgent' }, h('h3', {}, '⚠️ ' + it.fileName), h('p', {}, it.error), h('button', { class: 'act', onclick: drop }, 'إزالة'));
  const inp = (k, ph) => h('input', { type: 'text', value: it[k] || '', placeholder: ph, oninput: (e) => { it[k] = e.target.value; } });
  const text = h('textarea', { value: it.text || '', placeholder: 'نص الشكوى', oninput: (e) => { it.text = e.target.value; } });
  const dept = h('select', { onchange: (e) => { it.dept = e.target.value; } },
    h('option', { value: '' }, 'تحليل وتوجيه تلقائي'),
    ...(settings.departments || []).map((d) => h('option', { value: d }, d)));
  dept.value = it.dept || '';
  const pri = h('select', { onchange: (e) => { it.priority = e.target.value; } }, ...Object.entries(PRI).map(([k, v]) => h('option', { value: k }, v)));
  pri.value = it.priority || 'medium';
  return h('div', { class: 'card' },
    h('h3', {}, '📄 ' + (it.title || it.fileName)),
    it.imageB64 ? h('img', { src: 'data:image/jpeg;base64,' + it.imageB64 }) : '',
    it.warn ? h('p', { class: 'small' }, '⚠️ تعذّرت القراءة الآلية: ' + it.warn) : (!it.readable ? h('p', { class: 'small' }, '⚠️ لم يُقرأ النص بوضوح، اكتبه يدوياً من الصورة.') : ''),
    it.summary ? h('p', { class: 'small' }, '🤖 ' + it.summary) : '',
    h('label', {}, 'العنوان'), inp('title', 'عنوان الشكوى'),
    h('label', {}, 'نص الشكوى (راجعه وصحّحه)'), text,
    h('label', {}, 'اسم المواطن'), inp('name', ''),
    h('label', {}, 'الهاتف'), inp('phone', ''),
    h('label', {}, 'القسم المقترح'), dept,
    h('label', {}, 'الأولوية'), pri,
    h('div', {},
      h('button', { class: 'act', onclick: async () => {
        const r = await window.api.addComplaint({ title: it.title, text: it.text, name: it.name, phone: it.phone, department: it.dept, priority: it.priority, imageB64: it.imageB64, source: 'scan' });
        if (r.ok) { scanMsg = 'تم حفظ الشكوى'; drop(); } else document.getElementById('log').textContent = r.error;
      } }, 'حفظ الشكوى'),
      h('button', { class: 'act', onclick: drop }, 'تجاهل')));
}
function renderScan() {
  const top = h('div', { class: 'card' },
    h('h3', {}, '🖨️ مسح الشكاوى الورقية'),
    h('p', { class: 'small' }, 'امسح الورقة أو استورد صورتها؛ يقرأ النموذج النص ويحدد القسم والأولوية، ثم تراجع الشكوى وتحفظها فتدخل النظام كأي شكوى. الورقة بخط اليد قد تحتاج تصحيحاً قبل الحفظ.'),
    h('button', { class: 'act', disabled: scanBusy, onclick: async () => {
      scanBusy = true; scanMsg = 'بانتظار السكانر… أكمل المسح من نافذة الجهاز'; render();
      const r = await window.api.scanAcquire();
      scanBusy = false; scanMsg = r.ok ? 'تم المسح، جارٍ قراءة الورقة…' : (r.canceled ? '' : r.error); render();
    } }, '🖨️ مسح من السكانر'),
    h('button', { class: 'act', onclick: async () => {
      const r = await window.api.scanImport();
      scanMsg = r.ok ? 'جارٍ قراءة ' + r.count + ' صورة…' : ''; render();
    } }, '🖼️ استيراد صور'),
    scanMsg ? h('p', { class: 'small' }, scanMsg) : '',
    h('p', { class: 'small' }, 'مجلد المراقبة (للسكانرات التي تحفظ في مجلد، أو لمسح عدة أوراق متتالية): ' + (scanFolderPath || 'غير محدد')),
    h('button', { class: 'act', onclick: async () => { scanFolderPath = await window.api.scanFolder('pick'); render(); } }, '📁 اختيار مجلد'),
    scanFolderPath ? h('button', { class: 'act', onclick: async () => { scanFolderPath = await window.api.scanFolder('clear'); render(); } }, 'إيقاف المراقبة') : '');
  const out = [top];
  if (!scans.length) out.push(h('div', { class: 'empty' }, 'لا توجد ورقات ممسوحة بانتظار المراجعة'));
  scans.forEach((it) => out.push(scanCard(it)));
  return out;
}

// ---------------- الأرشيف المحلي (قراءة وبحث في نسخة SQLite) ----------------
const arch = { q: '', dept: 'all', status: 'all', from: '', to: '', sort: 'newest', page: 1 };
const ARCH_SORTS = { newest: 'الأحدث أولاً', oldest: 'الأقدم أولاً', resolved: 'الأحدث إنجازاً', dept: 'حسب القسم' };
let archToken = 0;
const archFilter = () => ({ ...arch, from: dateMs(arch.from), to: dateMs(arch.to, true), size: 25 });
const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

function archCard(c) {
  const meta = [STATUS[c.status] || c.status, c.department, c.priority ? 'أولوية ' + (PRI[c.priority] || c.priority) : '', c.area ? 'الحي: ' + c.area : '', c.crew ? 'الكادر: ' + c.crew : ''].filter(Boolean).join(' • ');
  const dates = (c.created_ms ? 'وصلت: ' + fmtT(c.created_ms) : '') + (c.resolved_ms ? ' • أُنجزت: ' + fmtT(c.resolved_ms) : '') + (c.rating ? ' • التقييم: ' + '⭐'.repeat(c.rating) : '');
  return h('div', { class: 'card st-' + c.status },
    h('h3', {}, c.title || '(بدون عنوان)'),
    h('small', {}, meta),
    h('p', { class: 'small' }, dates),
    h('details', {},
      h('summary', {}, 'عرض التفاصيل'),
      h('p', {}, c.text || ''),
      c.summary ? h('p', { class: 'small' }, '🤖 ملخص التحليل: ' + c.summary) : '',
      c.voice_text ? h('p', { class: 'small' }, '🎙️ تفريغ الصوت: ' + c.voice_text) : '',
      c.reply ? h('p', { class: 'reply' }, 'ملخص العمل: ' + c.reply) : '',
      (c.name || c.phone) ? h('p', { class: 'small' }, '👤 ' + [c.name, c.phone].filter(Boolean).join(' • ')) : '',
      (c.has_image || c.has_voice) ? h('p', { class: 'small' }, 'الصور والتسجيلات الصوتية لا تُنسخ إلى الأرشيف المحلي، وتبقى في Firestore.') : '',
      c.lat ? h('button', { class: 'act', onclick: () => window.api.openMap(c.lat, c.lng) }, '📍 الموقع') : '',
      h('p', { class: 'small' }, 'رقم الشكوى: ' + c.id)));
}

function renderArchive() {
  const box = h('div', {});
  const token = ++archToken;
  (async () => {
    const st = await window.api.archiveStats();
    if (token !== archToken) return;
    if (!st.ok) { box.append(h('div', { class: 'empty' }, 'تعذّر فتح الأرشيف: ' + st.error)); return; }
    const bar = h('div', { class: 'card bar' },
      field('القسم', sel([['all', 'كل الأقسام'], ...st.byDept.map((d) => [d.k, d.k + ' (' + d.n + ')'])], arch.dept, (v) => { arch.dept = v; arch.page = 1; render(); })),
      field('الحالة', sel([['all', 'الكل'], ...Object.entries(STATUS)], arch.status, (v) => { arch.status = v; arch.page = 1; render(); })),
      field('من تاريخ', h('input', { type: 'date', value: arch.from, onchange: (e) => { arch.from = e.target.value; arch.page = 1; render(); } })),
      field('إلى تاريخ', h('input', { type: 'date', value: arch.to, onchange: (e) => { arch.to = e.target.value; arch.page = 1; render(); } })),
      field('بحث (عنوان، نص، اسم، هاتف، رد…)', textBox(arch.q, (v) => { arch.q = v; arch.page = 1; })),
      field('الفرز', sel(Object.entries(ARCH_SORTS), arch.sort, (v) => { arch.sort = v; arch.page = 1; render(); })));
    const info = h('div', { class: 'sum' },
      h('span', { class: 'chip' }, 'إجمالي المؤرشف: ' + st.total),
      st.minMs ? h('span', { class: 'chip' }, 'من ' + fmtT(st.minMs) + ' إلى ' + fmtT(st.maxMs)) : '',
      h('span', { class: 'chip' }, 'حجم الملف: ' + fmtSize(st.size)));
    const res = h('div', { class: 'sum' });
    const acts = h('div', { class: 'card bar' },
      h('button', { class: 'act', onclick: () => render() }, '🔄 تحديث'),
      h('button', { class: 'act', onclick: async () => {
        const r = await window.api.archiveExport(archFilter());
        if (r.ok) res.textContent = 'تم تصدير ' + r.count + ' شكوى إلى ملف CSV يفتح في Excel';
        else if (!r.canceled) res.textContent = 'تعذّر التصدير: ' + r.error;
      } }, '⬇️ تصدير النتائج (Excel/CSV)'),
      h('button', { class: 'act', onclick: () => window.api.openArchive() }, '📂 فتح مجلد ملف الأرشيف'),
      h('span', { class: 'small' }, 'تُنسخ الشكاوى تلقائياً وتبقى هنا حتى لو حُذفت من Firebase.'));
    box.append(bar, info, acts, res);
    const q = await window.api.archiveQuery({ ...archFilter(), page: arch.page });
    if (token !== archToken) return;
    if (!q.ok) { box.append(h('div', { class: 'empty' }, 'تعذّر البحث: ' + q.error)); return; }
    arch.page = q.page;
    res.textContent = 'النتائج: ' + q.total + ' شكوى';
    if (!q.rows.length) { box.append(h('div', { class: 'empty' }, 'لا توجد شكاوى مطابقة في الأرشيف')); return; }
    const pager = () => h('div', { class: 'card pager bar' },
      h('button', { class: 'act', disabled: q.page <= 1, onclick: () => { arch.page = q.page - 1; render(); } }, 'السابق'),
      h('span', { class: 'small' }, 'صفحة ' + q.page + ' من ' + q.pages),
      h('button', { class: 'act', disabled: q.page >= q.pages, onclick: () => { arch.page = q.page + 1; render(); } }, 'التالي'));
    box.append(pager(), ...q.rows.map(archCard), pager());
  })();
  return [box];
}

function render() {
  const v = document.getElementById('view');
  v.replaceChildren();
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
  updateChrome();
  if (tab === 'settings') return v.append(...renderSettings());
  if (tab === 'report') return v.append(...renderReport());
  if (tab === 'setup') return v.append(...renderSetup());
  if (tab === 'crews') return v.append(...renderBusy());
  if (tab === 'perf') return v.append(...renderPerf());
  if (tab === 'classify') return v.append(...renderClassify());
  if (tab === 'done') return v.append(...renderDone());
  if (tab === 'archive') return v.append(...renderArchive());
  if (tab === 'scan') return v.append(...renderScan());
  if (tab === 'manual') return v.append(...renderManual());
  const items = list.filter((c) => (tab === 'new' ? c.status === 'new' : c.status !== 'new'));
  if (!items.length) return v.append(h('div', { class: 'empty' }, 'لا توجد شكاوى'));
  items.sort(MAIN_SORTS[mainSort][1]);
  const pg = paginate(tab, items, mainSort + '|' + items.length);
  const sortBar = h('div', { class: 'card bar' },
    field('الفرز', sel(Object.entries(MAIN_SORTS).map(([k, x]) => [k, x[0]]), mainSort, (val) => { mainSort = val; render(); })),
    h('span', { class: 'small' }, 'الإجمالي: ' + items.length + ' شكوى'),
    h('button', { class: 'act org-btn', onclick: () => { pg.slice.forEach((x) => openCards.add(x.id)); render(); } }, '📂 فتح تفاصيل الصفحة'),
    h('button', { class: 'act org-btn', onclick: () => { openCards.clear(); render(); } }, '📁 طي الكل'));
  v.append(sortBar, pg.bar(), ...pg.slice.map(card), pg.bar());
}

document.getElementById('view').addEventListener('click', (e) => { if (e.target.tagName === 'IMG' && e.target.src) zoom(e.target.src); });
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.t; render(); }));
window.api.onComplaints((d) => { list = d; if (tab !== 'settings' && tab !== 'manual' && tab !== 'archive' && tab !== 'scan') render(); });
window.api.onDeptCrews((d) => { deptCrews = d; if (tab === 'crews' || tab === 'perf' || tab === 'setup') render(); });
window.api.onStaff((d) => { staff = d; if (tab === 'report' || tab === 'crews' || tab === 'perf' || tab === 'setup') render(); });
setInterval(() => { if (tab === 'crews') render(); }, 60000);
window.api.onScan(scanOnItem);
window.api.scanFolder('get').then((p) => { scanFolderPath = p; });
window.api.onLog((m) => { document.getElementById('log').textContent = m; });
window.api.getSettings().then((s) => { settings = s; render(); });
