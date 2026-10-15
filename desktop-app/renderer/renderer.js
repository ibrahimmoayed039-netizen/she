const STATUS = { new: 'بانتظار التحليل', routed: 'تم التوجيه', in_progress: 'قيد المعالجة', resolved: 'تم الحل' };
const PRI = { urgent: 'عاجلة', high: 'عالية', medium: 'متوسطة', low: 'منخفضة' };
const PRI_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };
const TABS = ['new', 'routed', 'in_progress', 'resolved'];
const NONE = '__none'; // شكاوى لم تُصنَّف بعد (بلا قسم)

function load(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
function save(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }

let tab = 'new', list = [], settings = {};
let fDept = load('fDept', ''), fSort = load('fSort', 'newest');

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

// ===== التوقيت =====
function fmt(ms) {
  return ms ? new Date(ms).toLocaleString('ar-IQ-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }) : '';
}
function span(ms) { // مدة بصيغة عربية
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return 'أقل من دقيقة';
  if (m < 60) return m + ' دقيقة';
  const hr = Math.round(m / 60);
  if (hr < 24) return hr + ' ساعة';
  return Math.round(hr / 24) + ' يوم';
}
function ago(ms) { return Date.now() - ms < 60000 ? 'الآن' : 'قبل ' + span(Date.now() - ms); }

// ===== الفرز والتصفية =====
const st = (c) => (TABS.includes(c.status) ? c.status : 'routed');
const deptKey = (c) => c.department || NONE;
const deptName = (k) => (k === NONE ? 'غير مصنّفة' : k);

function sorted(arr) {
  const a = arr.slice();
  if (fSort === 'oldest') return a.sort((x, y) => x.createdMs - y.createdMs);
  if (fSort === 'priority') {
    return a.sort((x, y) => (PRI_RANK[x.priority] ?? 9) - (PRI_RANK[y.priority] ?? 9) || x.createdMs - y.createdMs);
  }
  return a.sort((x, y) => y.createdMs - x.createdMs); // newest + أساس التجميع
}

function refreshBar() {
  const counts = {};
  list.forEach((c) => { counts[deptKey(c)] = (counts[deptKey(c)] || 0) + 1; });
  const names = [...(settings.departments || [])];
  Object.keys(counts).forEach((k) => { if (k !== NONE && !names.includes(k)) names.push(k); });
  const opts = [['', `كل الأقسام (${list.length})`], ...names.map((n) => [n, `${n} (${counts[n] || 0})`])];
  if (counts[NONE]) opts.push([NONE, `غير مصنّفة (${counts[NONE]})`]);
  const sel = document.getElementById('fDept');
  const sig = JSON.stringify(opts);
  if (sel.dataset.sig !== sig) {
    sel.dataset.sig = sig;
    sel.replaceChildren(...opts.map(([v, t]) => h('option', { value: v }, t)));
  }
  if (!opts.some(([v]) => v === fDept)) fDept = '';
  sel.value = fDept;
  document.getElementById('fSort').value = fSort;
}

// ===== البطاقة =====
function card(c) {
  const rows = [
    ['📥', 'استُلمت', c.createdMs, c.status === 'resolved' ? '' : ' (' + ago(c.createdMs) + ')'],
    ['🧭', 'وُجّهت إلى القسم', c.routedMs, ''],
    ['👁', 'اطّلع عليها الموظف', c.seenMs, ''],
    ['🔧', 'بدأت معالجتها', c.startedMs, ''],
    ['✅', 'تم حلها', c.resolvedMs, c.resolvedMs && c.createdMs ? ' (استغرقت ' + span(c.resolvedMs - c.createdMs) + ')' : ''],
  ].filter((r) => r[2]);
  return h('div', { class: 'card' },
    h('h3', {}, c.title),
    h('div', { class: 'row' },
      h('span', { class: 'badge s-' + c.status }, STATUS[c.status] || c.status),
      c.department ? h('span', { class: 'chip' }, c.department) : '',
      c.priority ? h('span', { class: 'chip p-' + c.priority }, 'أولوية ' + PRI[c.priority]) : ''),
    (c.handledBy && c.status !== 'routed' && c.status !== 'new') ? h('div', { class: 'who' }, '👤 الموظف: ' + c.handledBy) : '',
    (c.handledBy && c.status === 'routed' && c.seenMs) ? h('div', { class: 'who' }, '👤 اطّلع عليها: ' + c.handledBy) : '',
    rows.length ? h('div', { class: 'tl' }, rows.map((r) => h('div', {}, `${r[0]} ${r[1]}: ${fmt(r[2])}${r[3]}`))) : '',
    c.imageB64 ? h('img', { src: 'data:image/jpeg;base64,' + c.imageB64 }) : '',
    h('p', {}, c.text),
    (c.lat != null && c.lng != null) ? h('button', { class: 'act', onclick: () => window.api.openMap(c.lat, c.lng) }, '📍 فتح موقع الشكوى في الخرائط') : '',
    c.resolvedImageB64 ? h('div', {}, h('div', { class: 'who' }, '📷 صورة بعد الحل'), h('img', { src: 'data:image/jpeg;base64,' + c.resolvedImageB64 })) : '',
    (c.name || c.phone) ? h('p', {}, 'المواطن: ' + c.name + ' ' + c.phone) : '',
    c.aiSummary ? h('p', { class: 'ai' }, '🤖 ' + c.aiSummary) : '',
    c.reply ? h('p', { class: 'reply' }, 'رد الموظف: ' + c.reply) : '',
    c.status === 'new' ? h('button', { class: 'act', onclick: () => window.api.analyze(c.id) }, 'تحليل وتوجيه الآن') : ''
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
          await window.api.connect(); refreshBar();
        },
      }, 'حفظ وإعادة الاتصال'))
  ];
}

function render() {
  const v = document.getElementById('view');
  v.replaceChildren();
  const isSettings = tab === 'settings';
  document.getElementById('bar').hidden = isSettings;
  refreshBar();
  const scoped = list.filter((c) => !fDept || deptKey(c) === fDept);
  document.querySelectorAll('nav button').forEach((b) => {
    b.classList.toggle('on', b.dataset.t === tab);
    if (TABS.includes(b.dataset.t)) b.textContent = `${STATUS[b.dataset.t]} (${scoped.filter((c) => st(c) === b.dataset.t).length})`;
  });
  if (isSettings) return v.append(...renderSettings());
  const items = sorted(scoped.filter((c) => st(c) === tab));
  if (!items.length) return v.append(h('div', { class: 'empty' }, 'لا توجد شكاوى'));
  if (fSort !== 'dept') return v.append(...items.map(card));
  // تجميع حسب القسم بترتيب الأقسام في الإعدادات
  const order = [...(settings.departments || []), NONE];
  const keys = [...new Set(items.map(deptKey))].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  keys.forEach((k) => {
    const g = items.filter((c) => deptKey(c) === k);
    v.append(h('h2', { class: 'grp' }, `${deptName(k)} (${g.length})`), ...g.map(card));
  });
}

document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.t; render(); }));
document.getElementById('fDept').addEventListener('change', (e) => { fDept = e.target.value; save('fDept', fDept); render(); });
document.getElementById('fSort').addEventListener('change', (e) => { fSort = e.target.value; save('fSort', fSort); render(); });
window.api.onComplaints((d) => { list = d; if (tab !== 'settings') render(); else refreshBar(); });
window.api.onLog((m) => { document.getElementById('log').textContent = m; });
window.api.getSettings().then((s) => { settings = s; render(); });
