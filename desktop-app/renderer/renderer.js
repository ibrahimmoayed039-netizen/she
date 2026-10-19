const STATUS = { new: 'بانتظار التحليل', routed: 'تم التوجيه', in_progress: 'قيد المعالجة', resolved: 'تم الحل' };
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

function timeline(c) {
  const rows = [
    ['📥 وصول الشكوى', c.createdMs],
    ['➡️ التوجيه إلى القسم', c.routedMs],
    ['🚧 استلام الكادر' + (c.crew ? ' (' + crewLabel(c) + ')' : ''), c.crewMs],
    ['📍 وصول الكادر إلى الموقع', c.arrivedMs],
    ['🔧 بدء المعالجة', c.startedMs],
    ['✅ وقت الإنجاز', c.resolvedMs],
  ].filter((r) => r[1]);
  if (!rows.length) return '';
  const extra = [];
  if (c.resolvedMs) {
    extra.push('⏱ مدة الإنجاز من الاستلام: ' + fmtD(c.resolvedMs - workStart(c)));
    extra.push('⏱ المدة الكلية منذ وصول الشكوى: ' + fmtD(c.resolvedMs - c.createdMs));
  } else if (c.status !== 'new' && c.createdMs) {
    extra.push('⏳ مضى على الشكوى: ' + fmtD(Date.now() - c.createdMs) + ' ولم تُنجز بعد');
  }
  return h('div', { class: 'small' },
    ...rows.map((r) => h('div', {}, r[0] + ': ' + fmtT(r[1]))),
    ...extra.map((t) => h('div', { class: c.resolvedMs ? '' : 'warn' }, t)));
}

function logButton(id) {
  const box = h('div', { class: 'small' });
  const btn = h('button', { class: 'act', onclick: async () => {
    if (box.childNodes.length) { box.replaceChildren(); return; }
    const items = await window.api.getLog(id);
    if (!items.length) { box.append('لا يوجد سجل بعد'); return; }
    items.forEach((i) => box.append(h('div', {}, new Date(i.ms).toLocaleString('ar-IQ') + ' — ' + i.by + ': ' + i.action)));
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

function card(c) {
  const urgent = c.priority === 'urgent' && c.status !== 'resolved';
  const meta = [STATUS[c.status] || c.status, c.department, c.priority ? 'أولوية ' + PRI[c.priority] : ''].filter(Boolean).join(' • ');
  return h('div', { class: urgent ? 'card urgent' : 'card' },
    h('h3', {}, (urgent ? '🚨 ' : '') + c.title),
    h('small', {}, meta),
    c.imageB64 ? h('img', { src: 'data:image/jpeg;base64,' + c.imageB64 }) : '',
    h('p', {}, c.text),
    (c.name || c.phone) ? h('p', {}, 'المواطن: ' + c.name + ' ' + c.phone) : '',
    c.category ? h('p', { class: 'small' }, '🗂 النوع الذي اختاره المواطن: ' + c.category + (c.aiDepartment ? ' (اقترح التحليل: ' + c.aiDepartment + ')' : '')) : '',
    c.dupTitle ? h('p', { class: 'rep no' }, '🔁 مكررة: تشبه شكوى سابقة («' + c.dupTitle + '»)') : '',
    c.dupCount ? h('p', { class: 'small' }, '🔁 تكررت هذه الشكوى ' + c.dupCount + ' مرة') : '',
    c.lat !== null ? h('button', { class: 'act', onclick: () => window.api.openMap(c.lat, c.lng) }, '📍 فتح الموقع على الخريطة') : '',
    c.crew ? h('p', { class: 'rep yes' }, '🚧 الكادر المسؤول: ' + crewLabel(c)) : '',
    c.afterImageB64 ? h('div', {}, h('b', {}, 'صورة بعد الصيانة:'), h('img', { src: 'data:image/jpeg;base64,' + c.afterImageB64 })) : '',
    c.rating ? h('p', {}, 'تقييم المواطن: ' + '⭐'.repeat(c.rating)) : '',
    timeline(c),
    priorityPicker(c),
    c.aiSummary ? h('p', { class: 'ai' }, '🤖 ' + c.aiSummary) : '',
    (c.repairable === true || c.repairable === false) ? h('div', { class: c.repairable ? 'rep yes' : 'rep no' },
      h('b', {}, c.repairable ? '✅ تقرير الموظف: ممكن صيانتها' : '❌ تقرير الموظف: غير ممكن صيانتها'),
      c.branch ? h('div', {}, 'الفرع: ' + c.branch) : '',
      (c.repairable && c.materials) ? h('div', {}, 'المواد المطلوبة: ' + c.materials) : '') : '',
    c.reply ? h('p', { class: 'reply' }, 'رد الموظف: ' + c.reply) : '',
    c.status === 'new' ? h('button', { class: 'act', onclick: () => window.api.analyze(c.id) }, 'تحليل وتوجيه الآن') : '',
    logButton(c.id)
  );
}

function renderSettings() {
  const provider = h('select', {},
    h('option', { value: 'claude' }, 'Claude (يحتاج مفتاح API ورصيد)'),
    h('option', { value: 'local' }, 'محلي Ollama (مجاني، بدون إنترنت)'),
    h('option', { value: 'hybrid' }, 'هجين: المحلي أولاً ثم Claude عند الشك أو الفشل'));
  provider.value = settings.provider || 'claude';
  const ollamaUrl = h('input', { type: 'text', value: settings.ollamaUrl || 'http://localhost:11434' });
  const ollamaModel = h('input', { type: 'text', value: settings.ollamaModel || '', placeholder: 'الاسم كما يظهر في الأمر ollama list' });
  const localImages = h('input', { type: 'checkbox', checked: !!settings.localImages });
  const rules = h('textarea', { value: settings.rules || '', rows: 8, placeholder: 'اكتب هنا قواعد التوجيه، مثلاً: كسر الشارع والحفر → البلدية' });
  const key = h('input', { type: 'password', value: settings.apiKey || '' });
  const model = h('input', { type: 'text', value: settings.model || '' });
  const depts = h('textarea', { value: (settings.departments || []).join('\n') });
  const auto = h('input', { type: 'checkbox', checked: !!settings.auto });
  const path = h('span', {}, settings.serviceAccountPath || 'لم يُحدد بعد');
  return [
    h('div', { class: 'card' },
      h('label', {}, 'طريقة التحليل'), provider,
      h('label', {}, 'مفتاح Claude API (للوضعين Claude والهجين)'), key,
      h('label', {}, 'اسم النموذج'), model,
      h('label', {}, 'عنوان Ollama'), ollamaUrl,
      h('label', {}, 'اسم نموذج Ollama'), ollamaModel,
      h('label', {}, localImages, ' النموذج المحلي يدعم الصور (فعّلها فقط لنموذج يفهم الصور)'),
      h('button', { class: 'act', onclick: () => window.api.testOllama() }, 'فحص اتصال Ollama'),
      h('label', {}, 'تعليمات التوجيه (اشرح للنموذج أي شكوى تذهب لأي قسم)'), rules,
      h('label', {}, 'الأقسام (قسم في كل سطر — يجب أن تطابق أقسام الموظفين تماماً)'), depts,
      h('label', {}, auto, ' التحليل والتوجيه التلقائي للشكاوى الجديدة'),
      h('label', {}, 'مفتاح حساب خدمة Firebase (JSON)'),
      h('button', { class: 'act', onclick: async () => { const p = await window.api.pickKey(); settings.serviceAccountPath = p; path.textContent = p || 'لم يُحدد بعد'; } }, 'اختيار الملف'), ' ', path,
      h('p', {}),
      h('button', {
        class: 'act',
        onclick: async () => {
          settings = {
            ...settings, provider: provider.value, rules: rules.value.trim(), ollamaUrl: ollamaUrl.value.trim(), ollamaModel: ollamaModel.value.trim(), localImages: localImages.checked,
            apiKey: key.value.trim(), model: model.value.trim(), auto: auto.checked,
            departments: depts.value.split('\n').map((s) => s.trim()).filter(Boolean),
          };
          await window.api.setSettings(settings);
          await window.api.connect();
        },
      }, 'حفظ وإعادة الاتصال'))
  ];
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
  status: ['حسب الحالة', (a, b) => ORD(['routed', 'in_progress', 'resolved'], a.status) - ORD(['routed', 'in_progress', 'resolved'], b.status) || b.createdMs - a.createdMs],
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
  status: { name: 'الحالة', f: (c) => ({ k: ORD(['new', 'routed', 'in_progress', 'resolved'], c.status), l: STATUS[c.status] || c.status }) },
  priority: { name: 'الأولوية', f: (c) => ({ k: ORD(['urgent', 'high', 'medium', 'low'], c.priority), l: 'أولوية ' + (PRI[c.priority] || 'غير محددة') }) },
  crew: { name: 'الكادر', f: (c) => ({ k: c.crew || '~', l: c.crew ? '🚧 ' + c.crew : 'بدون كادر' }) },
  branch: { name: 'الفرع', f: (c) => ({ k: c.branch || '~', l: c.branch || 'بدون فرع' }) },
  speed: { name: 'سرعة الإنجاز', f: speedOf },
  rating: { name: 'تقييم المواطن', f: (c) => c.rating ? { k: 5 - c.rating, l: '⭐'.repeat(c.rating) + ' (' + c.rating + ')' } : { k: 9, l: 'لم يُقيَّم' } },
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
      h('small', {}, [c.department, c.crew ? 'الكادر: ' + crewLabel(c) : '', c.branch ? 'الفرع: ' + c.branch : ''].filter(Boolean).join(' • ')),
      h('p', { class: 'small' }, (c.resolvedMs ? 'أُنجزت: ' + fmtT(c.resolvedMs) + ' • مدة الإنجاز: ' + fmtD(c.resolvedMs - workStart(c)) : 'وقت الإنجاز غير مسجّل') + (c.rating ? ' • التقييم: ' + '⭐'.repeat(c.rating) : '')),
      c.reply ? h('p', { class: 'reply' }, 'ملخص العمل: ' + c.reply) : '',
      (c.materials && c.repairable) ? h('p', { class: 'small' }, 'المواد: ' + c.materials) : '',
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
let crewAdd = { department: '', names: '', msg: '' };
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
      h('button', { class: 'act', onclick: async () => {
        if (!confirm('حذف هذا الحساب نهائياً؟\n' + label + '\n(لا يحذف الشكاوى السابقة)')) return;
        await run(window.api.deleteStaff(s.id), 'تم الحذف');
      } }, '🗑 حذف'), st));
}
let deptCrews = [];
let deptStaffForm = { department: '', name: '', email: '', password: '', msg: '' };
function deptStaffCard() {
  const depts = allDepts();
  if (!deptStaffForm.department && depts.length) deptStaffForm.department = depts[0];
  const f = deptStaffForm;
  const inp = (key, ph) => h('input', { type: 'text', placeholder: ph, value: f[key], oninput: (e) => { f[key] = e.target.value; } });
  const msg = h('div', { class: 'small' }, f.msg);
  const accounts = staff.filter((s) => s.role !== 'crew');
  return h('div', { class: 'card' },
    h('h3', {}, '👤 إنشاء حساب موظف قسم'),
    h('p', { class: 'small' }, 'الحساب الذي يستلم شكاوى القسم ويُسند الكوادر (بدل Firebase Console).'),
    h('div', { class: 'bar' },
      field('القسم', sel(depts.map((d) => [d, d]), f.department, (v) => { f.department = v; })),
      field('الاسم (اختياري)', inp('name', 'اسم الموظف')),
      field('البريد', inp('email', 'staff@example.com')),
      field('كلمة المرور', inp('password', '6 أحرف على الأقل')),
      h('button', { class: 'act', onclick: async () => {
        msg.textContent = 'جارٍ الإنشاء...';
        const r = await window.api.createDeptStaff({ ...f });
        f.msg = r.ok ? '✅ تم إنشاء الحساب' : '❌ ' + r.error;
        if (r.ok) { f.name = ''; f.email = ''; f.password = ''; }
        render();
      } }, 'إنشاء')),
    msg,
    accounts.length ? h('div', {}, h('b', {}, 'حسابات الموظفين:'),
      ...accounts.map((s) => accountRow(s, (s.departments.join('، ') || '-') + (s.email ? ' • ' + s.email : '')))) : '');
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
      h('button', { class: 'act', onclick: async () => {
        const list2 = crewAdd.names.split(/[،,;؛\n]/).map((v) => v.trim()).filter(Boolean);
        if (!list2.length) { crewAdd.msg = 'اكتب اسماً واحداً على الأقل'; return render(); }
        msg.textContent = 'جارٍ الحفظ...';
        const r = await window.api.editCrews(crewAdd.department, list2, []);
        crewAdd.msg = r.ok ? '✅ تمت الإضافة' : '❌ ' + r.error;
        if (r.ok) crewAdd.names = '';
        render();
      } }, 'إضافة')),
    msg,
    ...depts.map((d) => {
      const ns = namesOf(d);
      return ns.length ? h('div', { class: 'sum' }, h('b', {}, d + ': '),
        ...ns.map((k) => h('span', { class: 'chip' }, '🚧 ' + k + ' ',
          h('a', { href: '#', title: 'حذف من القائمة', onclick: async (e) => {
            e.preventDefault();
            if (!confirm('حذف «' + k + '» من كوادر ' + d + '؟ (لا يحذف حساب الكادر ولا شكاواه)')) return;
            const r = await window.api.editCrews(d, [], [k]);
            crewAdd.msg = r.ok ? '✅ تم الحذف' : '❌ ' + r.error; render();
          } }, '✖')))) : '';
    }));
}

// ---------------- حسابات الكوادر ----------------
let crewForm = { department: '', crew: '', name: '', email: '', password: '', count: '1', msg: '', results: [] };
// اسم المسؤول عن الكادر (من حساب الكادر) لعرضه بجانب اسم الكادر
function crewLabel(c) {
  if (!c.crew) return '';
  const a = staff.find((s) => s.role === 'crew' && s.crew === c.crew && s.departments.includes(c.department));
  return c.crew + (a && a.name ? ' (' + a.name + ')' : '');
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
      field('القسم', sel(depts.map((d) => [d, d]), crewForm.department, (v) => { crewForm.department = v; })),
      field('اسم الكادر', inp('crew', 'مثال: كادر')),
      field('اسم المسؤول (اختياري)', inp('name', 'مثال: أحمد علي')),
      field('عدد الكوادر', h('input', { type: 'number', min: '1', max: '30', value: crewForm.count, oninput: (e) => { crewForm.count = e.target.value; } })),
      field('البريد (أو أساسه)', inp('email', 'crew@example.com')),
      field('كلمة المرور (للجميع)', inp('password', '6 أحرف على الأقل', 'text')),
      h('button', { class: 'act', onclick: async () => {
        msg.textContent = 'جارٍ الإنشاء...';
        const r = await window.api.createCrew({ ...crewForm });
        crewForm.msg = r.ok ? '✅ تم إنشاء ' + r.results.length + ' حساب' : '❌ ' + r.error;
        crewForm.results = r.results || [];
        if (r.ok) { crewForm.crew = ''; crewForm.name = ''; crewForm.email = ''; crewForm.password = ''; crewForm.count = '1'; }
        render();
      } }, 'إنشاء')),
    h('p', { class: 'small' }, 'عند اختيار عدد أكبر من 1 يُرقَّم الاسم والبريد تلقائياً: «كادر» + 3 ← كادر 1، كادر 2، كادر 3 (crew1@، crew2@، crew3@ بنفس الدومين وكلمة المرور).'),
    msg,
    ...crewForm.results.map((r) => h('div', { class: r.ok ? 'rep yes' : 'rep no' }, (r.ok ? '✅ ' : '❌ ') + r.crew + ' — ' + r.email + (r.ok ? '' : ' : ' + r.error))),
    accounts.length ? h('div', {}, h('b', {}, 'الحسابات الحالية:'),
      ...accounts.map((s) => accountRow(s, '🚧 ' + s.crew + ' • ' + (s.departments[0] || '') + (s.email ? ' • ' + s.email : '')))) : '');
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
        dept, crew, label: crewLabel({ crew, department: dept }),
        assigned: cs.length, done: done.length, open: cs.length - done.length,
        rate: cs.length ? Math.round((done.length / cs.length) * 100) : null,
        dur: mean(done.filter((c) => c.resolvedMs).map((c) => c.resolvedMs - workStart(c))),
        resp: mean(cs.filter((c) => c.arrivedMs && c.crewMs && c.arrivedMs >= c.crewMs).map((c) => c.arrivedMs - c.crewMs)),
        rating: mean(rated.map((c) => c.rating)), ratedN: rated.length,
      });
    });
  });
  return rows;
}

function renderPerf() {
  const bar = h('div', { class: 'card bar' },
    field('الفترة', sel(Object.entries(PERIODS), perf.from || perf.to ? '' : perf.period, (v) => { perf.period = v; perf.from = ''; perf.to = ''; render(); })),
    field('من', h('input', { type: 'date', value: perf.from, onchange: (e) => { perf.from = e.target.value; render(); } })),
    field('إلى', h('input', { type: 'date', value: perf.to, onchange: (e) => { perf.to = e.target.value; render(); } })),
    field('القسم', sel([['all', 'كل الأقسام'], ...allDepts().map((d) => [d, d])], perf.dept, (v) => { perf.dept = v; render(); })));
  const rows = perfRows();
  if (!rows.length) return [bar, h('div', { class: 'empty' }, 'لا توجد كوادر معرّفة بعد')];

  // الترتيب: القيم الفارغة تأتي أخيراً دائماً
  const key = perf.sort;
  rows.sort((a, b) => {
    const x = a[key], y = b[key];
    if (x === null || x === undefined) return (y === null || y === undefined) ? 0 : 1;
    if (y === null || y === undefined) return -1;
    return (x - y) * perf.dir || (b.done - a.done);
  });

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
  const sum = h('div', { class: 'sum' },
    h('span', { class: 'chip' }, 'الكوادر: ' + rows.length),
    h('span', { class: 'chip' }, 'الأعمال المُسندة: ' + tot.a),
    h('span', { class: 'chip ok' }, 'المنجزة: ' + tot.d),
    h('span', { class: 'chip warn' }, 'قيد العمل: ' + (tot.a - tot.d)));

  const max = Math.max(1, ...rows.map((r) => r.done));
  const COLS = [['done', 'منجزة'], ['assigned', 'مُسندة'], ['open', 'قيد العمل'], ['rate', 'نسبة الإنجاز'], ['dur', 'متوسط زمن الإنجاز'], ['resp', 'متوسط الاستجابة'], ['rating', 'التقييم']];
  const th = (k, l) => h('th', { class: 'sortable', onclick: () => { if (perf.sort === k) perf.dir = -perf.dir; else { perf.sort = k; perf.dir = (k === 'dur' || k === 'resp') ? 1 : -1; } render(); } },
    l + (perf.sort === k ? (perf.dir === -1 ? ' ▼' : ' ▲') : ''));
  const medal = ['🥇', '🥈', '🥉'];
  const table = h('table', {},
    h('tr', {}, h('th', {}, '#'), h('th', {}, 'الكادر'), h('th', {}, 'القسم'), ...COLS.map(([k, l]) => th(k, l))),
    ...rows.map((r, i) => h('tr', {},
      h('td', {}, r.assigned ? (medal[i] || String(i + 1)) : String(i + 1)),
      h('td', {}, r.label), h('td', {}, r.dept),
      h('td', {}, r.done + ' ' + '█'.repeat(Math.round((r.done / max) * 12))),
      h('td', {}, String(r.assigned)),
      h('td', { class: r.open ? 'warn' : '' }, String(r.open)),
      h('td', {}, r.rate === null ? '-' : r.rate + '%'),
      h('td', {}, r.dur === null ? '-' : fmtD(r.dur)),
      h('td', {}, r.resp === null ? '-' : fmtD(r.resp)),
      h('td', {}, r.rating === null ? '-' : '⭐ ' + r.rating.toFixed(1) + ' (' + r.ratedN + ')'))));
  return [bar, hl, sum, h('div', { class: 'card' }, h('p', { class: 'small' }, 'الأعمال المحسوبة هي المُسندة للكادر خلال الفترة. اضغط عنوان أي عمود لإعادة الترتيب. زمن الاستجابة = من الإسناد حتى وصول الكادر للموقع.'), table)];
}

function renderBusy() {
  const stats = crewStats();
  if (!stats.length) return [crewManager(), crewAccounts(), deptStaffCard(), h('div', { class: 'empty' }, 'لا توجد كوادر معرّفة بعد: أضف أسماءها من «كوادر الأقسام» أعلاه')];
  const now = Date.now();
  const out = [crewManager(), crewAccounts(), deptStaffCard()];
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

function renderReport() {
  const stats = branchStats();
  const crewCards = renderCrews();
  if (!stats.length && !crewCards.length) return [h('div', { class: 'empty' }, 'لا توجد بيانات بعد')];
  return [...stats.map((d) => {
    const working = d.rows.filter((r) => r.open > 0).length;
    const finished = d.rows.filter((r) => r.total > 0 && r.open === 0).length;
    const idle = d.rows.filter((r) => r.total === 0).length;
    return h('div', { class: 'card' },
      h('h3', {}, d.dept),
      h('div', { class: 'sum' },
        h('span', { class: 'chip' }, 'عدد الفروع: ' + d.rows.length),
        h('span', { class: 'chip warn' }, 'فروع لديها عمل متبقٍ: ' + working),
        h('span', { class: 'chip ok' }, 'فروع أنجزت كل شكاواها: ' + finished),
        h('span', { class: 'chip' }, 'فروع بلا شكاوى: ' + idle)),
      d.rows.length ? h('table', {},
        h('tr', {}, ...['الفرع', 'الشكاوى', 'المتبقي', 'المنجز', 'ممكن صيانتها', 'غير ممكن'].map((x) => h('th', {}, x))),
        ...d.rows.map((r) => h('tr', {},
          h('td', {}, r.branch), h('td', {}, String(r.total)),
          h('td', { class: r.open ? 'warn' : '' }, String(r.open)),
          h('td', {}, String(r.done)), h('td', {}, String(r.can)), h('td', {}, String(r.cant))))) : '',
      d.noBranchTotal ? h('p', { class: 'small' }, 'شكاوى لم يُحدَّد لها فرع: ' + d.noBranchTotal + ' (المتبقي منها ' + d.noBranchOpen + ')') : '');
  }), ...crewCards];
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

function render() {
  const v = document.getElementById('view');
  v.replaceChildren();
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
  if (tab === 'settings') return v.append(...renderSettings());
  if (tab === 'report') return v.append(...renderReport());
  if (tab === 'crews') return v.append(...renderBusy());
  if (tab === 'perf') return v.append(...renderPerf());
  if (tab === 'classify') return v.append(...renderClassify());
  if (tab === 'done') return v.append(...renderDone());
  if (tab === 'manual') return v.append(...renderManual());
  const items = list.filter((c) => (tab === 'new' ? c.status === 'new' : c.status !== 'new'));
  if (!items.length) return v.append(h('div', { class: 'empty' }, 'لا توجد شكاوى'));
  items.sort(MAIN_SORTS[mainSort][1]);
  const pg = paginate(tab, items, mainSort + '|' + items.length);
  const sortBar = h('div', { class: 'card bar' },
    field('الفرز', sel(Object.entries(MAIN_SORTS).map(([k, x]) => [k, x[0]]), mainSort, (val) => { mainSort = val; render(); })),
    h('span', { class: 'small' }, 'الإجمالي: ' + items.length + ' شكوى'));
  v.append(sortBar, pg.bar(), ...pg.slice.map(card), pg.bar());
}

document.getElementById('view').addEventListener('click', (e) => { if (e.target.tagName === 'IMG' && e.target.src) zoom(e.target.src); });
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.t; render(); }));
window.api.onComplaints((d) => { list = d; if (tab !== 'settings' && tab !== 'manual') render(); });
window.api.onDeptCrews((d) => { deptCrews = d; if (tab === 'crews' || tab === 'perf') render(); });
window.api.onStaff((d) => { staff = d; if (tab === 'report' || tab === 'crews' || tab === 'perf') render(); });
setInterval(() => { if (tab === 'crews') render(); }, 60000);
window.api.onLog((m) => { document.getElementById('log').textContent = m; });
window.api.getSettings().then((s) => { settings = s; render(); });
